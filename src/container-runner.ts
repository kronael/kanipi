import {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  exec,
  spawn,
} from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';

import crypto from 'crypto';

import { getManifest } from './action-registry.js';
import { recordSessionStart, updateSessionEnd } from './db.js';
import {
  ASSISTANT_NAME,
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  DATA_DIR,
  GROUPS_DIR,
  HOST_APP_DIR,
  HOST_PROJECT_ROOT_PATH,
  IDLE_TIMEOUT,
  TIMEZONE,
  WEB_DIR,
  WEB_HOST,
  isRoot,
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
import { RegisteredGroup, SidecarHandle, SidecarSpec } from './types.js';

export let _spawnProcess: (
  cmd: string,
  args: string[],
  opts: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams = spawn;

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  messageCount?: number;
  delegateDepth?: number;
  // Enricher annotations prepended to prompt before container sees it.
  // Populated by runEnrichers() in index.ts — not sent as a separate field.
  _annotations?: string[];
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

function chownRecursive(dir: string, uid: number, gid: number): void {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      fs.chownSync(p, uid, gid);
      if (entry.isDirectory()) chownRecursive(p, uid, gid);
    }
    fs.chownSync(dir, uid, gid);
  } catch (err) {
    logger.debug({ dir, err }, 'chown skipped');
  }
}

const APP_DIR = process.cwd();

const _mvFile = path.join(
  APP_DIR,
  'container',
  'skills',
  'self',
  'MIGRATION_VERSION',
);
const LATEST_MIGRATION_VERSION = fs.existsSync(_mvFile)
  ? parseInt(fs.readFileSync(_mvFile, 'utf-8').trim(), 10) || 0
  : 0;

// Translate container-local path to host-side path for docker mounts.
// DATA_DIR parent = PROJECT_ROOT (/srv/app/home); HOST_PROJECT_ROOT_PATH = /srv/data/kanipi_<name>
const GATEWAY_ROOT = path.dirname(DATA_DIR);
function hostPath(localPath: string): string {
  return localPath.replace(GATEWAY_ROOT, HOST_PROJECT_ROOT_PATH);
}

function buildVolumeMounts(
  group: RegisteredGroup,
  delegateDepth?: number,
): VolumeMount[] {
  const root = isRoot(group.folder);
  const mounts: VolumeMount[] = [];
  const groupDir = resolveGroupFolderPath(group.folder);

  // All groups get their own folder as working directory
  mounts.push({
    hostPath: hostPath(groupDir),
    containerPath: '/workspace/group',
    readonly: false,
  });

  // Media dir — enriched attachments, mounted rw so agent can write sidecars
  const mediaDir = path.join(groupDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  mounts.push({
    hostPath: hostPath(mediaDir),
    containerPath: '/workspace/media',
    readonly: false,
  });

  // All groups get kanipi source read-only as /workspace/self
  mounts.push({
    hostPath: HOST_APP_DIR,
    containerPath: '/workspace/self',
    readonly: true,
  });

  const world = group.folder.split('/')[0];
  const shareDir = path.join(GROUPS_DIR, world, 'share');
  fs.mkdirSync(shareDir, { recursive: true });
  mounts.push({
    hostPath: hostPath(shareDir),
    containerPath: '/workspace/share',
    readonly: !root,
  });

  const groupSessionsDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
  );
  fs.mkdirSync(groupSessionsDir, { recursive: true });
  chownRecursive(groupSessionsDir, 1000, 1000);
  const settingsFile = path.join(groupSessionsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(
      settingsFile,
      JSON.stringify(
        {
          env: {
            // Load CLAUDE.md from additional mounted directories
            // https://code.claude.com/docs/en/memory#load-memory-from-additional-directories
            CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
            // Enable Claude's memory feature (persists user preferences between sessions)
            // https://code.claude.com/docs/en/memory#manage-auto-memory
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
          },
        },
        null,
        2,
      ) + '\n',
    );
  }
  // Always inject env vars that change per spawn (host, identity, slink token).
  {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    settings.env = settings.env ?? {};
    settings.env.WEB_HOST = WEB_HOST;
    settings.env.NANOCLAW_ASSISTANT_NAME = ASSISTANT_NAME;
    settings.env.NANOCLAW_IS_ROOT = root ? '1' : '';
    settings.env.NANOCLAW_DELEGATE_DEPTH = String(delegateDepth ?? 0);
    if (group.slinkToken) settings.env.SLINK_TOKEN = group.slinkToken;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  }

  // Seed skills once per group — agent can modify, persists across spawns
  const skillsSrc = path.join(APP_DIR, 'container', 'skills');
  const skillsDst = path.join(groupSessionsDir, 'skills');
  if (fs.existsSync(skillsSrc)) {
    for (const skillDir of fs.readdirSync(skillsSrc)) {
      if (!/^[a-z0-9\-]+$/.test(skillDir)) {
        logger.warn(`skipping skill with invalid name: ${skillDir}`);
        continue;
      }
      const srcDir = path.join(skillsSrc, skillDir);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      const dstDir = path.join(skillsDst, skillDir);
      if (!fs.existsSync(dstDir)) {
        fs.cpSync(srcDir, dstDir, { recursive: true });
      }
    }
    chownRecursive(skillsDst, 1000, 1000);
  }
  const claudeMdSrc = path.join(APP_DIR, 'container', 'CLAUDE.md');
  const claudeMdDst = path.join(groupSessionsDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdSrc) && !fs.existsSync(claudeMdDst)) {
    fs.copyFileSync(claudeMdSrc, claudeMdDst);
  }
  mounts.push({
    hostPath: hostPath(groupSessionsDir),
    containerPath: '/home/node/.claude',
    readonly: false,
  });

  const groupIpcDir = resolveGroupIpcPath(group.folder);
  fs.mkdirSync(path.join(groupIpcDir, 'messages'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'requests'), { recursive: true });
  fs.mkdirSync(path.join(groupIpcDir, 'replies'), { recursive: true });
  chownRecursive(groupIpcDir, 1000, 1000);
  mounts.push({
    hostPath: hostPath(groupIpcDir),
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  const agentRunnerSrc = path.join(APP_DIR, 'container', 'agent-runner', 'src');
  const groupAgentRunnerDir = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    'agent-runner-src',
  );
  if (!fs.existsSync(groupAgentRunnerDir) && fs.existsSync(agentRunnerSrc)) {
    fs.cpSync(agentRunnerSrc, groupAgentRunnerDir, { recursive: true });
    chownRecursive(groupAgentRunnerDir, 1000, 1000);
  }
  mounts.push({
    hostPath: HOST_APP_DIR + '/container/agent-runner/src',
    containerPath: '/app/src',
    readonly: false,
  });

  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      root,
    );
    mounts.push(...validatedMounts);
  }

  if (fs.existsSync(WEB_DIR)) {
    chownRecursive(WEB_DIR, 1000, 1000);
    mounts.push({
      hostPath: hostPath(WEB_DIR),
      containerPath: '/workspace/web',
      readonly: false,
    });
  }

  // Root group gets data/sessions/ rw so migrate skill can sync across groups
  if (root) {
    const sessionsDir = path.join(DATA_DIR, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    mounts.push({
      hostPath: hostPath(sessionsDir),
      containerPath: '/workspace/data/sessions',
      readonly: false,
    });
  }

  return mounts;
}

function readSecrets(): Record<string, string> {
  return readEnvFile(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']);
}

function buildContainerArgs(
  mounts: VolumeMount[],
  containerName: string,
): string[] {
  const args: string[] = [
    'run',
    '-i',
    '--rm',
    '--name',
    containerName,
    '--shm-size=1g',
  ];

  // Pass host timezone so container's local time matches the user's
  args.push('-e', `TZ=${TIMEZONE}`);

  // Run as host user so bind-mounted files are accessible.
  // Skip when running as root (uid 0), as the container's node user (uid 1000),
  // or when getuid is unavailable (native Windows without WSL).
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

  args.push(CONTAINER_IMAGE);

  return args;
}

// --- Sidecar lifecycle ---

function execCmd(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function waitForSocket(
  sockPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(sockPath)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for socket: ${sockPath}`);
}

function probeSidecar(sockPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection(sockPath);
    const timer = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 1000);
    sock.on('connect', () => {
      clearTimeout(timer);
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function resolveSidecars(
  group: RegisteredGroup,
): Array<SidecarSpec & { name: string }> {
  const specs: Record<string, SidecarSpec> = {};

  for (const [key, val] of Object.entries(process.env)) {
    const m = key.match(/^SIDECAR_([A-Z0-9]+(?:_[A-Z0-9]+)*)_IMAGE$/);
    if (m && val) {
      const name = m[1].toLowerCase().replace(/_/g, '-');
      specs[name] = { image: val };
    }
  }

  if (group.containerConfig?.sidecars) {
    for (const [name, spec] of Object.entries(group.containerConfig.sidecars)) {
      if (spec.image) {
        specs[name] = { ...specs[name], ...spec };
      } else {
        delete specs[name]; // empty image = disabled
      }
    }
  }

  return Object.entries(specs).map(([name, spec]) => ({ name, ...spec }));
}

async function startSidecar(
  name: string,
  spec: SidecarSpec,
  sockDir: string,
  groupFolder: string,
): Promise<SidecarHandle | null> {
  const safeName = groupFolder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-sidecar-${name}-${safeName}`;
  const sockPath = path.join(sockDir, `${name}.sock`);

  if (fs.existsSync(sockPath)) {
    try {
      fs.unlinkSync(sockPath);
    } catch {}
  }

  const args = [
    'run',
    '-d',
    '--rm',
    '--name',
    containerName,
    `--memory=${spec.memoryMb ?? 256}m`,
    `--cpus=${spec.cpus ?? 0.5}`,
    `--network=${spec.network ?? 'none'}`,
    '-v',
    `${hostPath(sockDir)}:/run/socks`,
    '-e',
    `MCP_SOCK=/run/socks/${name}.sock`,
  ];

  if (spec.env) {
    for (const [k, v] of Object.entries(spec.env)) {
      args.push('-e', `${k}=${v}`);
    }
  }

  args.push(spec.image);

  try {
    await execCmd(`${CONTAINER_RUNTIME_BIN} ${args.join(' ')}`);
    await waitForSocket(sockPath, 5000);
    const ok = await probeSidecar(sockPath);
    if (!ok) {
      logger.warn(
        { name, containerName },
        'sidecar probe failed, excluding from settings',
      );
      execCmd(`${CONTAINER_RUNTIME_BIN} stop ${containerName}`).catch(() => {});
      return null;
    }
    logger.info({ name, containerName }, 'sidecar ready');
    return {
      containerName,
      specName: name,
      sockPath,
      allowedTools: spec.allowedTools,
    };
  } catch (err) {
    logger.warn({ name, containerName, err }, 'sidecar start failed, skipping');
    return null;
  }
}

async function startSidecars(
  group: RegisteredGroup,
  sockDir: string,
): Promise<SidecarHandle[]> {
  const specs = resolveSidecars(group);
  if (specs.length === 0) return [];

  const results = await Promise.all(
    specs.map((s) => startSidecar(s.name, s, sockDir, group.folder)),
  );
  return results.filter((h): h is SidecarHandle => h !== null);
}

function injectSidecarsIntoSettings(
  settingsFile: string,
  handles: SidecarHandle[],
): void {
  if (handles.length === 0) return;

  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  settings.mcpServers = settings.mcpServers ?? {};

  const allowedTools: string[] = [];
  for (const h of handles) {
    settings.mcpServers[h.specName] = {
      command: 'socat',
      args: [
        `UNIX-CONNECT:/workspace/ipc/sidecars/${h.specName}.sock`,
        'STDIO',
      ],
    };
    if (!h.allowedTools || h.allowedTools.includes('*')) {
      allowedTools.push(`mcp__${h.specName}__*`);
    } else {
      for (const t of h.allowedTools) {
        allowedTools.push(`mcp__${h.specName}__${t}`);
      }
    }
  }

  if (!Array.isArray(settings.allowedTools)) {
    settings.allowedTools = [];
  }
  settings.allowedTools = [...settings.allowedTools, ...allowedTools];

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
}

async function stopSidecars(handles: SidecarHandle[]): Promise<void> {
  await Promise.all(
    handles.map((h) =>
      execCmd(`${CONTAINER_RUNTIME_BIN} stop ${h.containerName}`).catch(
        () => {},
      ),
    ),
  );
}

// --- Agent runner ---

export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });
  chownRecursive(groupDir, 1000, 1000);

  const mounts = buildVolumeMounts(group);

  // Start sidecars before agent; socket dir lives under IPC dir (already mounted)
  const sockDir = path.join(resolveGroupIpcPath(group.folder), 'sidecars');
  fs.mkdirSync(sockDir, { recursive: true });
  chownRecursive(sockDir, 1000, 1000);
  const sidecarHandles = await startSidecars(group, sockDir);

  const settingsFile = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
    'settings.json',
  );
  injectSidecarsIntoSettings(settingsFile, sidecarHandles);

  const agentVersionFile = path.join(
    DATA_DIR,
    'sessions',
    group.folder,
    '.claude',
    'skills',
    'self',
    'MIGRATION_VERSION',
  );
  const agentVersion = fs.existsSync(agentVersionFile)
    ? parseInt(fs.readFileSync(agentVersionFile, 'utf-8').trim(), 10) || 0
    : 0;
  if (agentVersion < LATEST_MIGRATION_VERSION) {
    input._annotations = input._annotations ?? [];
    input._annotations.push(
      `[pending migration] Skills version ${agentVersion} < ${LATEST_MIGRATION_VERSION}. ` +
        `Run /migrate (main group) to sync all groups.`,
    );
  }

  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  logger.debug(
    {
      group: group.name,
      containerName,
      mounts: mounts.map(
        (m) =>
          `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
      ),
      containerArgs: containerArgs.join(' '),
    },
    'Container mount configuration',
  );

  logger.info(
    {
      group: group.name,
      containerName,
      mountCount: mounts.length,
      root: isRoot(group.folder),
    },
    'Spawning container agent',
  );

  const logsDir = path.join(groupDir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true });

  const sessionRowId = crypto.randomUUID();
  const sessionStartedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const container = _spawnProcess(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    recordSessionStart(sessionRowId, group.folder, sessionStartedAt);
    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Prepend enricher annotations to prompt
    if (input._annotations && input._annotations.length > 0) {
      input.prompt = `${input._annotations.join('\n')}\n\n${input.prompt}`;
    }
    delete input._annotations;

    // Pass secrets via stdin (never written to disk or mounted as files)
    input.secrets = readSecrets();
    container.stdin.write(JSON.stringify(input));
    container.stdin.end();
    // Remove secrets from input so they don't appear in logs
    delete input.secrets;

    // Streaming output: parse OUTPUT_START/END marker pairs as they arrive
    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();

    container.stdout.on('data', (data) => {
      const chunk = data.toString();

      // Always accumulate for logging
      if (!stdoutTruncated) {
        const remaining = CONTAINER_MAX_OUTPUT_SIZE - stdout.length;
        if (chunk.length > remaining) {
          stdout += chunk.slice(0, remaining);
          stdoutTruncated = true;
          logger.warn(
            { group: group.name, size: stdout.length },
            'Container stdout truncated due to size limit',
          );
        } else {
          stdout += chunk;
        }
      }

      // Stream-parse for output markers
      if (onOutput) {
        parseBuffer += chunk;
        let startIdx: number;
        while ((startIdx = parseBuffer.indexOf(OUTPUT_START_MARKER)) !== -1) {
          const endIdx = parseBuffer.indexOf(OUTPUT_END_MARKER, startIdx);
          if (endIdx === -1) break; // Incomplete pair, wait for more data

          const jsonStr = parseBuffer
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
          parseBuffer = parseBuffer.slice(endIdx + OUTPUT_END_MARKER.length);

          try {
            const parsed: ContainerOutput = JSON.parse(jsonStr);
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            // Activity detected — reset the hard timeout
            resetTimeout();
            // Call onOutput for all markers (including null results)
            // so idle timers start even for "silent" query completions.
            outputChain = outputChain.then(() => onOutput(parsed));
          } catch (err) {
            logger.warn(
              { group: group.name, error: err },
              'Failed to parse streamed output chunk',
            );
          }
        }
      }
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      const lines = chunk.trim().split('\n');
      for (const line of lines) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      // Don't reset timeout on stderr — SDK writes debug logs continuously.
      // Timeout only resets on actual output (OUTPUT_MARKER in stdout).
      if (stderrTruncated) return;
      const remaining = CONTAINER_MAX_OUTPUT_SIZE - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
        logger.warn(
          { group: group.name, size: stderr.length },
          'Container stderr truncated due to size limit',
        );
      } else {
        stderr += chunk;
      }
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;
    // Grace period: hard timeout must be at least IDLE_TIMEOUT + 30s so the
    // graceful _close sentinel has time to trigger before the hard kill fires.
    const timeoutMs = Math.max(configTimeout, IDLE_TIMEOUT + 30_000);

    const killOnTimeout = () => {
      timedOut = true;
      logger.error(
        { group: group.name, containerName },
        'Container timeout, stopping gracefully',
      );
      exec(stopContainer(containerName), { timeout: 15000 }, (err) => {
        if (err) {
          logger.warn(
            { group: group.name, containerName, err },
            'Graceful stop failed, force killing',
          );
          container.kill('SIGKILL');
        }
      });
    };

    let timeout = setTimeout(killOnTimeout, timeoutMs);

    // Reset the timeout whenever there's activity (streaming output)
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, timeoutMs);
    };

    const finishSession = (
      sid: string | undefined,
      result: 'ok' | 'error' | 'unknown',
      err?: string,
    ) => {
      try {
        updateSessionEnd(
          sessionRowId,
          sid,
          new Date().toISOString(),
          result,
          err,
          input.messageCount ?? 0,
        );
      } catch {}
    };

    container.on('close', (code) => {
      clearTimeout(timeout);
      stopSidecars(sidecarHandles).catch(() => {});
      const duration = Date.now() - startTime;

      if (timedOut) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const timeoutLog = path.join(logsDir, `container-${ts}.log`);
        fs.writeFileSync(
          timeoutLog,
          [
            `=== Container Run Log (TIMEOUT) ===`,
            `Timestamp: ${new Date().toISOString()}`,
            `Group: ${group.name}`,
            `Container: ${containerName}`,
            `Duration: ${duration}ms`,
            `Exit Code: ${code}`,
            `Had Streaming Output: ${hadStreamingOutput}`,
          ].join('\n'),
        );

        // Timeout after output = idle cleanup, not failure.
        // The agent already sent its response; this is just the
        // container being reaped after the idle period expired.
        if (hadStreamingOutput) {
          logger.info(
            { group: group.name, containerName, duration, code },
            'Container timed out after output (idle cleanup)',
          );
          outputChain.then(() => {
            finishSession(newSessionId, 'ok');
            resolve({
              status: 'success',
              result: null,
              newSessionId,
            });
          });
          return;
        }

        logger.error(
          { group: group.name, containerName, duration, code },
          'Container timed out with no output',
        );

        finishSession(
          newSessionId,
          'error',
          `Container timed out after ${configTimeout}ms`,
        );
        resolve({
          status: 'error',
          result: null,
          error: `Container timed out after ${configTimeout}ms`,
        });
        return;
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `container-${timestamp}.log`);
      const isVerbose =
        process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'trace';

      const logLines = [
        `=== Container Run Log ===`,
        `Timestamp: ${new Date().toISOString()}`,
        `Group: ${group.name}`,
        `IsRoot: ${isRoot(input.groupFolder)}`,
        `Duration: ${duration}ms`,
        `Exit Code: ${code}`,
        `Stdout Truncated: ${stdoutTruncated}`,
        `Stderr Truncated: ${stderrTruncated}`,
        ``,
      ];

      const isError = code !== 0;

      if (isVerbose || isError) {
        logLines.push(
          `=== Input ===`,
          JSON.stringify(input, null, 2),
          ``,
          `=== Container Args ===`,
          containerArgs.join(' '),
          ``,
          `=== Mounts ===`,
          mounts
            .map(
              (m) =>
                `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`,
            )
            .join('\n'),
          ``,
          `=== Stderr${stderrTruncated ? ' (TRUNCATED)' : ''} ===`,
          stderr,
          ``,
          `=== Stdout${stdoutTruncated ? ' (TRUNCATED)' : ''} ===`,
          stdout,
        );
      } else {
        logLines.push(
          `=== Input Summary ===`,
          `Prompt length: ${input.prompt.length} chars`,
          `Session ID: ${input.sessionId || 'new'}`,
          ``,
          `=== Mounts ===`,
          mounts
            .map((m) => `${m.containerPath}${m.readonly ? ' (ro)' : ''}`)
            .join('\n'),
          ``,
        );
      }

      fs.writeFileSync(logFile, logLines.join('\n'));
      logger.debug({ logFile, verbose: isVerbose }, 'Container log written');

      if (code !== 0) {
        logger.error(
          {
            group: group.name,
            code,
            duration,
            stderr,
            stdout,
            logFile,
          },
          'Container exited with error',
        );

        const errMsg = `Container exited with code ${code}: ${stderr.slice(-200)}`;
        finishSession(newSessionId, 'error', errMsg);
        resolve({
          status: 'error',
          result: null,
          error: errMsg,
        });
        return;
      }

      // Streaming mode: wait for output chain to settle, return completion marker
      if (onOutput) {
        outputChain.then(() => {
          logger.info(
            { group: group.name, duration, newSessionId },
            'Container completed (streaming mode)',
          );
          finishSession(newSessionId, 'ok');
          resolve({
            status: 'success',
            result: null,
            newSessionId,
          });
        });
        return;
      }

      // Legacy mode: parse the last output marker pair from accumulated stdout
      try {
        // Extract JSON between sentinel markers for robust parsing
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line (backwards compatibility)
          const lines = stdout.trim().split('\n');
          jsonLine = lines[lines.length - 1];
        }

        const output: ContainerOutput = JSON.parse(jsonLine);

        logger.info(
          {
            group: group.name,
            duration,
            status: output.status,
            hasResult: !!output.result,
          },
          'Container completed',
        );

        finishSession(
          output.newSessionId,
          output.status === 'success' ? 'ok' : 'error',
          output.error,
        );
        resolve(output);
      } catch (err) {
        logger.error(
          {
            group: group.name,
            stdout,
            stderr,
            error: err,
          },
          'Failed to parse container output',
        );

        const errMsg = `Failed to parse container output: ${err instanceof Error ? err.message : String(err)}`;
        finishSession(undefined, 'error', errMsg);
        resolve({
          status: 'error',
          result: null,
          error: errMsg,
        });
      }
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      logger.error(
        { group: group.name, containerName, error: err },
        'Container spawn error',
      );
      finishSession(
        undefined,
        'error',
        `Container spawn error: ${err.message}`,
      );
      resolve({
        status: 'error',
        result: null,
        error: `Container spawn error: ${err.message}`,
      });
    });
  });
}

export function writeTasksSnapshot(
  groupFolder: string,
  tasks: Array<{
    id: string;
    groupFolder: string;
    prompt: string;
    schedule_type: string;
    schedule_value: string;
    status: string;
    next_run: string | null;
  }>,
): void {
  const root = isRoot(groupFolder);
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const filteredTasks = root
    ? tasks
    : tasks.filter((t) => t.groupFolder === groupFolder);

  const tasksFile = path.join(groupIpcDir, 'current_tasks.json');
  fs.writeFileSync(tasksFile, JSON.stringify(filteredTasks, null, 2));
}

export function writeActionManifest(groupFolder: string): void {
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });
  const manifestFile = path.join(groupIpcDir, 'action_manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(getManifest(), null, 2));
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

export function writeGroupsSnapshot(
  groupFolder: string,
  groups: AvailableGroup[],
  registeredJids: Set<string>,
): void {
  const root = isRoot(groupFolder);
  const groupIpcDir = resolveGroupIpcPath(groupFolder);
  fs.mkdirSync(groupIpcDir, { recursive: true });

  const visibleGroups = root ? groups : [];

  const groupsFile = path.join(groupIpcDir, 'available_groups.json');
  fs.writeFileSync(
    groupsFile,
    JSON.stringify(
      {
        groups: visibleGroups,
        lastSync: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}
