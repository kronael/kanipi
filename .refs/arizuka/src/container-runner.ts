import { ChildProcess, exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  getAgentConfig,
  getContainerImage,
  getContainerTimeout,
  getIdleTimeout,
  DATA_DIR,
  GROUPS_DIR,
  TIMEZONE,
} from './config.js';
import { readEnvFile } from './env.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  stopContainer,
} from './container-runtime.js';
import { validateAdditionalMounts } from './mount-security.js';
import { AgentConfig, RegisteredGroup } from './types.js';

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';
const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760', 10,
);

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  agentId?: string;
  secrets?: Record<string, string>;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

function writePersonality(groupDir: string, personality: string): void {
  const claudeMd = path.join(groupDir, 'CLAUDE.md');
  // Only write if missing or changed — don't overwrite user edits after first run
  if (!fs.existsSync(claudeMd)) {
    fs.writeFileSync(claudeMd, personality + '\n');
  }
}

function buildVolumeMounts(
  group: RegisteredGroup,
  isMain: boolean,
  agentCfg?: AgentConfig,
): VolumeMount[] {
  const mounts: VolumeMount[] = [];
  const projectRoot = process.cwd();
  const groupDir = resolveGroupFolderPath(group.folder);

  if (isMain) {
    mounts.push({
      hostPath: projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    mounts.push({
      hostPath: groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    const globalDir = path.join(GROUPS_DIR, 'global');
    if (fs.existsSync(globalDir)) {
      mounts.push({
        hostPath: globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  const groupSessionsDir = path.join(DATA_DIR, 'sessions', group.folder, '.claude');
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify({
        env: {
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
          CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
        },
      }, null, 2) + '\n',
    );
  }

  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      fs.cpSync(srcDir, dstDir, { recursive: true });
    }
  }
  mounts.push({
    hostPath: groupSessionsDir,
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  mounts.push({
    hostPath: groupIpcDir,
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  const agentRunnerSrc = path.join(projectRoot, 'container', 'agent-runner', 'src');
  const groupAgentRunnerDir = path.join(DATA_DIR, 'sessions', group.folder, 'agent-runner-src');
  if (!fs.existsSync(groupAgentRunnerDir) && fs.existsSync(agentRunnerSrc)) {
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
  }
  mounts.push({
    hostPath: groupAgentRunnerDir,
    containerPath: '/app/src',
    readonly: false,
  });

  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts, group.name, isMain,
    );
    mounts.push(...validatedMounts);
  }

  // Per-agent extra mounts
  if (agentCfg?.mounts) {
    const validatedMounts = validateAdditionalMounts(
      agentCfg.mounts, group.name, isMain,
    );
    mounts.push(...validatedMounts);
  }

  // Write per-agent personality to group folder
  if (agentCfg?.personality) {
    const groupDir = resolveGroupFolderPath(group.folder);
    writePersonality(groupDir, agentCfg.personality);
  }

  return mounts;
}

function readSecrets(): Record<string, string> {
  return readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
  agentCfg?: AgentConfig,
): string[] {
  const args: string[] = ['run', '-i', '--rm', '--name', containerName];

  // Security: capability drop + resource limits always on
  args.push('--cap-drop', 'ALL');
  args.push('--security-opt', 'no-new-privileges');
  args.push('--memory', '1g');
  args.push('--cpus', '2');

  // Network: default ON (agent needs Anthropic API). Set network: false per-agent
  // to fully isolate (Phase 2: Crackbox proxy for selective access).
  const allowNetwork = agentCfg?.network !== false;
  if (!allowNetwork) {
    args.push('--network', 'none');
  }

  args.push('-e', `TZ=${TIMEZONE}`);

  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
    args.push('-e', 'HOME=/home/node');
  }

  for (const mount of mounts) {
    if (mount.readonly) {
      args.push(...readonlyMountArgs(mount.hostPath, mount.containerPath));
    } else {
      args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
    }
  }

  // Per-agent image override or global default
  const image = agentCfg?.image ?? getContainerImage();
  args.push(image);

  return args;
}

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const agentCfg = input.agentId ? getAgentConfig(input.agentId) : undefined;
  const mounts = buildVolumeMounts(group, input.isMain, agentCfg);
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `arizuka-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName, agentCfg);

  logger.info(
    { group: group.name, containerName, mountCount: mounts.length, isMain: input.isMain },
    'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  return new Promise((resolve) => {
    const container = spawn(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    input.secrets = readSecrets();
    container.stdin.write(JSON.stringify(input));
    container.stdin.end();
    delete input.secrets;

    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();
    let timedOut = false;
    let hadStreamingOutput = false;

    const configTimeout = agentCfg?.timeout ?? group.containerConfig?.timeout ?? getContainerTimeout();
    const idleTimeout = getIdleTimeout();
    const timeoutMs = Math.max(configTimeout, idleTimeout + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error({ group: group.name, containerName }, 'Container timeout, stopping');
      exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
        if (err) container.kill('SIGKILL');
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
        } else {
          stdout += chunk;
        }
      }

      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break;

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) newSessionId = parsed.newSessionId;
            hadStreamingOutput = true;
            resetTimeout();
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn({ group: group.name, error: err }, 'Failed to parse streamed output');
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    });

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        if (hadStreamingOutput) {
          outputChain.then(() => resolve({ status: 'success', result: null, newSessionId }));
          return;
        }
        resolve({ status: 'error', result: null, error: `Container timed out after ${configTimeout}ms` });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose = process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsMain: ${input.isMain}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        ``,
      ];

      if (isVerbose || code !== 0) {
        logLines.push(`=== Stderr ===`, stderr, ``, `=== Stdout ===`, stdout);
      }

      fs.writeFileSync(logFile, logLines.join('\n'));

      if (code !== 0) {
        logger.error({ group: group.name, code, duration, logFile }, 'Container exited with error');
        resolve({ status: 'error', result: null, error: `Container exited with code ${code}: ${stderr.slice(-200)}` });
        return;
      }

      if (onOutput) {
        outputChain.then(() => {
          logger.info({ group: group.name, duration, newSessionId }, 'Container completed (streaming)');
          resolve({ status: 'success', result: null, newSessionId });
        });
        return;
      }

      try {
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);
        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout.slice(startIdx + OUTPUT_START_MARKER.length, endIdx).trim();
        } else {
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }
        const output: ContainerOutput = JSON.parse(jsonLine);
        resolve(output);
      } catch (err) {
        resolve({ status: 'error', result: null, error: `Failed to parse container output: ${err}` });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ status: 'error', result: null, error: `Container spawn error: ${err.message}` });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  isMain: boolean,
  tasks: Array<{
    id: string; groupFolder: string; prompt: string;
    schedule_type: string; schedule_value: string; status: string; next_run: string | null;
  }>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const filteredTasks = isMain ? tasks : tasks.filter((t) => t.groupFolder === groupFolder);
  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

export function writeGroupsSnapshot(
  groupFolder: string,
  isMain: boolean,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const visibleGroups = isMain ? groups : [];
  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(groupsFile, JSON.stringify({ groups: visibleGroups, lastSync: new Date().toISOString() }, null, 2));
}
