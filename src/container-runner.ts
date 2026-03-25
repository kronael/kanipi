import {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  spawn,
} from 'child_process';
import fs from 'fs';
import path from 'path';

import crypto from 'crypto';

import { recordSessionStart, updateSessionEnd } from './db.js';
import {
  ASSISTANT_NAME,
  CONTAINER_IMAGE,
  CONTAINER_MAX_OUTPUT_SIZE,
  CONTAINER_TIMEOUT,
  GROUPS_DIR,
  HOST_APP_DIR,
  HOST_DATA_DIR,
  HOST_GROUPS_DIR,
  MEDIA_ENABLED,
  MEDIA_MAX_FILE_BYTES,
  TIMEZONE,
  VIDEO_TRANSCRIPTION_ENABLED,
  VOICE_TRANSCRIPTION_ENABLED,
  WEB_DIR,
  WEB_HOST,
  HOST_WEB_DIR,
  WHISPER_BASE_URL,
  WHISPER_MODEL,
  isRoot,
  permissionTier,
} from './config.js';
import { readEnvFile } from './env.js';
import { resolveGroupFolderPath, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import {
  CONTAINER_RUNTIME_BIN,
  readonlyMountArgs,
  stopContainerArgs,
} from './container-runtime.js';
import { validateAdditionalMounts } from './mount-security.js';
import { GroupConfig } from './db.js';
import { worldOf } from './permissions.js';
import {
  checkAction,
  deriveRules,
  getGrantOverrides,
  type Rule,
} from './grants.js';

export let _spawnProcess: (
  cmd: string,
  args: string[],
  opts: { stdio: ['pipe', 'pipe', 'pipe'] },
) => ChildProcessWithoutNullStreams = spawn;

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function appendWithLimit(
  buffer: string,
  chunk: string,
  limit: number,
  truncated: boolean,
): { buffer: string; truncated: boolean } {
  if (truncated) return { buffer, truncated };
  const remaining = limit - buffer.length;
  if (chunk.length > remaining) {
    return { buffer: buffer + chunk.slice(0, remaining), truncated: true };
  }
  return { buffer: buffer + chunk, truncated };
}

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  messageCount?: number;
  channelName?: string;
  delegateDepth?: number;
  messageId?: string;
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

const migrationVersionFile = path.join(
  process.cwd(),
  'container',
  'skills',
  'self',
  'MIGRATION_VERSION',
);
const LATEST_MIGRATION_VERSION = fs.existsSync(migrationVersionFile)
  ? parseInt(fs.readFileSync(migrationVersionFile, 'utf-8').trim(), 10) || 0
  : 0;

const DEFAULT_SETTINGS = {
  env: {
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
  },
};

function initSettings(dir: string, spawnEnv: Record<string, string>): void {
  const file = path.join(dir, 'settings.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n');
  }
  const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
  settings.env = { ...(settings.env ?? {}), ...spawnEnv };
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function updateSettings(
  dir: string,
  update: (settings: Record<string, unknown>) => void,
): void {
  const file = path.join(dir, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
  update(settings);
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function buildVolumeMounts(
  group: GroupConfig,
  grantOverrides: Rule[] | null,
  delegateDepth?: number,
): VolumeMount[] {
  const root = isRoot(group.folder);
  const tier = permissionTier(group.folder);
  const groupRules = deriveRules(group.folder, tier);
  const mounts: VolumeMount[] = [];
  const groupDir = resolveGroupFolderPath(group.folder);
  const hostGroupDir = path.join(HOST_GROUPS_DIR, group.folder);

  try {
    fs.chownSync(groupDir, 1000, 1000);
  } catch {
    /* best-effort */
  }

  mounts.push({
    hostPath: hostGroupDir,
    containerPath: '/home/node',
    readonly: tier === 3,
  });

  if (tier >= 2) {
    for (const f of ['CLAUDE.md', 'SOUL.md']) {
      const p = path.join(groupDir, f);
      if (fs.existsSync(p)) {
        mounts.push({
          hostPath: path.join(hostGroupDir, f),
          containerPath: `/home/node/${f}`,
          readonly: true,
        });
      }
    }
    for (const f of ['CLAUDE.md', 'skills', 'settings.json', 'output-styles']) {
      const p = path.join(groupDir, '.claude', f);
      if (fs.existsSync(p)) {
        mounts.push({
          hostPath: path.join(hostGroupDir, '.claude', f),
          containerPath: `/home/node/.claude/${f}`,
          readonly: true,
        });
      }
    }
  }

  if (tier === 3) {
    for (const d of ['.claude/projects', 'media', 'tmp']) {
      const dir = path.join(groupDir, d);
      fs.mkdirSync(dir, { recursive: true });
      mounts.push({
        hostPath: path.join(hostGroupDir, d),
        containerPath: `/home/node/${d}`,
        readonly: false,
      });
    }
  }

  if (group.parent) {
    try {
      const protoSkillsDir = path.join(
        resolveGroupFolderPath(group.parent),
        'skills',
      );
      if (fs.existsSync(protoSkillsDir)) {
        mounts.push({
          hostPath: path.join(HOST_GROUPS_DIR, group.parent, 'skills'),
          containerPath: '/home/node/skills',
          readonly: true,
        });
      }
    } catch (err) {
      logger.debug(
        { group: group.name, parent: group.parent, err },
        'skipping prototype skills mount',
      );
    }
  }

  for (const d of ['media', 'diary']) {
    fs.mkdirSync(path.join(groupDir, d), { recursive: true });
  }

  if (tier === 0) {
    mounts.push({
      hostPath: HOST_APP_DIR,
      containerPath: '/workspace/self',
      readonly: true,
    });
  }

  const allRules = [...groupRules, ...(grantOverrides ?? [])];
  const shareRw = checkAction(allRules, 'share_mount', { readonly: 'false' });
  const shareRo =
    !shareRw && checkAction(allRules, 'share_mount', { readonly: 'true' });
  if (shareRw || shareRo) {
    const shareDir = path.join(GROUPS_DIR, worldOf(group.folder), 'share');
    fs.mkdirSync(shareDir, { recursive: true });
    mounts.push({
      hostPath: path.join(HOST_GROUPS_DIR, worldOf(group.folder), 'share'),
      containerPath: '/workspace/share',
      readonly: !shareRw,
    });
  }

  const claudeStateDir = path.join(groupDir, '.claude');
  fs.mkdirSync(claudeStateDir, { recursive: true });
  chownRecursive(claudeStateDir, 1000, 1000);
  initSettings(claudeStateDir, {
    WEB_HOST,
    NANOCLAW_ASSISTANT_NAME: ASSISTANT_NAME,
    NANOCLAW_IS_ROOT: root ? '1' : '',
    NANOCLAW_TIER: String(tier),
    NANOCLAW_IS_WORLD_ADMIN: tier === 1 ? '1' : '',
    NANOCLAW_GROUP_NAME: group.name,
    NANOCLAW_GROUP_FOLDER: group.folder,
    NANOCLAW_DELEGATE_DEPTH: String(delegateDepth ?? 0),
    ...(group.slinkToken ? { SLINK_TOKEN: group.slinkToken } : {}),
    ...(WHISPER_BASE_URL ? { WHISPER_BASE_URL } : {}),
  });

  const appDir = process.cwd();
  const skillsSrc = path.join(
    appDir,
    'templates',
    'default',
    '.claude',
    'skills',
  );
  const skillsDst = path.join(claudeStateDir, 'skills');
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
  const claudeMdSrc = path.join(
    appDir,
    'templates',
    'default',
    '.claude',
    'CLAUDE.md',
  );
  const claudeMdDst = path.join(claudeStateDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdSrc) && !fs.existsSync(claudeMdDst)) {
    fs.copyFileSync(claudeMdSrc, claudeMdDst);
  }

  const claudeJsonPath = path.join(groupDir, '.claude.json');
  if (!fs.existsSync(claudeJsonPath)) {
    const userID = crypto
      .createHash('sha256')
      .update(`kanipi:${group.folder}`)
      .digest('hex');
    fs.writeFileSync(
      claudeJsonPath,
      JSON.stringify({
        firstStartTime: new Date().toISOString(),
        userID,
        thinkingMigrationComplete: true,
        sonnet45MigrationComplete: true,
        opus45MigrationComplete: true,
        opusProMigrationComplete: true,
      }) + '\n',
    );
    fs.chownSync(claudeJsonPath, 1000, 1000);
  }

  const stylesSrc = path.join(
    appDir,
    'templates',
    'default',
    '.claude',
    'output-styles',
  );
  const stylesDst = path.join(claudeStateDir, 'output-styles');
  if (fs.existsSync(stylesSrc)) {
    fs.cpSync(stylesSrc, stylesDst, { recursive: true });
  }

  const groupIpcDir = resolveGroupIpcPath(group.folder);
  for (const sub of ['messages', 'tasks', 'input', 'requests', 'replies']) {
    fs.mkdirSync(path.join(groupIpcDir, sub), { recursive: true });
  }
  chownRecursive(groupIpcDir, 1000, 1000);
  mounts.push({
    hostPath: path.join(HOST_DATA_DIR, 'ipc', group.folder),
    containerPath: '/workspace/ipc',
    readonly: false,
  });

  mounts.push({
    hostPath: HOST_APP_DIR + '/container/agent-runner/src',
    containerPath: '/app/src',
    readonly: tier === 3,
  });

  if (group.containerConfig?.additionalMounts) {
    const validatedMounts = validateAdditionalMounts(
      group.containerConfig.additionalMounts,
      group.name,
      root,
    );
    mounts.push(...validatedMounts);
  }

  if (fs.existsSync(WEB_DIR) && tier <= 2) {
    if (tier === 0) {
      chownRecursive(WEB_DIR, 1000, 1000);
      mounts.push({
        hostPath: path.resolve(HOST_DATA_DIR, '../web'),
        containerPath: '/workspace/web',
        readonly: false,
      });
    } else {
      const world = worldOf(group.folder);
      const worldDir = path.join(WEB_DIR, world);
      fs.mkdirSync(worldDir, { recursive: true });
      chownRecursive(worldDir, 1000, 1000);
      mounts.push({
        hostPath: path.join(HOST_WEB_DIR, world),
        containerPath: '/workspace/web',
        readonly: false,
      });
    }
  }

  if (tier === 0) {
    mounts.push({
      hostPath: HOST_GROUPS_DIR,
      containerPath: '/home/node/groups',
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
  command: string[] = ['/app/entrypoint.sh'],
): string[] {
  const args: string[] = [
    'run',
    '-i',
    '--rm',
    '--name',
    containerName,
    '--shm-size=1g',
  ];

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

  args.push(CONTAINER_IMAGE, ...command);

  return args;
}

function writeGatewayCaps(groupDir: string): void {
  let languages: string[] = [];
  try {
    languages = fs
      .readFileSync(path.join(groupDir, '.whisper-language'), 'utf-8')
      .split('\n')
      .map((l) => l.trim().replace(/[^a-zA-Z-]/g, ''))
      .filter(Boolean);
  } catch {}

  const langArray = languages.length
    ? `[${languages.map((l) => `"${l}"`).join(', ')}]`
    : '[]';

  const toml = [
    '[voice]',
    `enabled = ${VOICE_TRANSCRIPTION_ENABLED}`,
    `model = "${WHISPER_MODEL}"`,
    `languages = ${langArray}`,
    '',
    '[video]',
    `enabled = ${VIDEO_TRANSCRIPTION_ENABLED}`,
    '',
    '[media]',
    `enabled = ${MEDIA_ENABLED}`,
    `max_size_mb = ${Math.round(MEDIA_MAX_FILE_BYTES / (1024 * 1024))}`,
    '',
    '[web]',
    `enabled = ${!!WEB_HOST}`,
    `host = "${WEB_HOST}"`,
    '',
  ].join('\n');

  fs.writeFileSync(path.join(groupDir, '.gateway-caps'), toml);
}

export async function runContainerCommand(
  group: GroupConfig,
  input: ContainerInput | string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  command?: string[],
): Promise<ContainerOutput> {
  if (command) {
    return runRawCommand(group, input, onProcess, command);
  }
  if (typeof input === 'string') {
    throw new Error('agent mode requires ContainerInput object');
  }
  return runAgentMode(group, input, onProcess, onOutput);
}

async function runRawCommand(
  group: GroupConfig,
  input: ContainerInput | string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  command: string[],
): Promise<ContainerOutput> {
  const startTime = Date.now();
  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const mounts = buildVolumeMounts(group, getGrantOverrides(group.folder));
  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName, command);

  logger.info(
    { group: group.name, containerName, command },
    'Spawning raw container command',
  );

  return new Promise((resolve) => {
    const container = _spawnProcess(CONTAINER_RUNTIME_BIN, containerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    onProcess(container, containerName);

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    if (typeof input === 'string' && input) {
      container.stdin.write(input);
    }
    container.stdin.end();

    container.stdout.on('data', (data) => {
      const chunk = data.toString();
      const result = appendWithLimit(
        stdout,
        chunk,
        CONTAINER_MAX_OUTPUT_SIZE,
        stdoutTruncated,
      );
      stdout = result.buffer;
      stdoutTruncated = result.truncated;
    });

    container.stderr.on('data', (data) => {
      const chunk = data.toString();
      for (const line of chunk.trim().split('\n')) {
        if (line) logger.debug({ container: group.folder }, line);
      }
      const result = appendWithLimit(
        stderr,
        chunk,
        CONTAINER_MAX_OUTPUT_SIZE,
        stderrTruncated,
      );
      stderr = result.buffer;
      stderrTruncated = result.truncated;
    });

    let timedOut = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;

    const killOnTimeout = () => {
      timedOut = true;
      logger.error(
        { group: group.name, containerName },
        'Raw command timeout, stopping',
      );
      const stopArgs = stopContainerArgs(containerName);
      const stop = spawn(CONTAINER_RUNTIME_BIN, stopArgs, {
        stdio: 'ignore',
        timeout: 15000,
      });
      stop.on('close', (code) => {
        if (code !== 0) container.kill('SIGKILL');
      });
      stop.on('error', () => container.kill('SIGKILL'));
    };

    const timeout = setTimeout(killOnTimeout, configTimeout);

    container.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;

      if (timedOut) {
        resolve({
          status: 'error',
          result: null,
          error: `Raw command timed out after ${configTimeout}ms`,
        });
        return;
      }

      if (code !== 0) {
        logger.error(
          { group: group.name, code, duration, stderr },
          'Raw command exited with error',
        );
        resolve({
          status: 'error',
          result: null,
          error: `Raw command exited with code ${code}: ${stderr.slice(-200)}`,
        });
        return;
      }

      logger.info({ group: group.name, duration }, 'Raw command completed');
      resolve({
        status: 'success',
        result: stdout.trim() || null,
      });
    });

    container.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        status: 'error',
        result: null,
        error: `Raw command spawn error: ${err.message}`,
      });
    });
  });
}

async function runAgentMode(
  group: GroupConfig,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<ContainerOutput> {
  const startTime = Date.now();

  const groupDir = resolveGroupFolderPath(group.folder);
  fs.mkdirSync(groupDir, { recursive: true });

  const grantOverrides: Rule[] | null = getGrantOverrides(group.folder);
  const mounts = buildVolumeMounts(group, grantOverrides, input.delegateDepth);

  updateSettings(path.join(groupDir, '.claude'), (settings) => {
    if (input.channelName) {
      settings.outputStyle = input.channelName;
    } else {
      delete settings.outputStyle;
    }
  });

  const agentVersionFile = path.join(
    groupDir,
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

  writeGatewayCaps(groupDir);

  const safeName = group.folder.replace(/[^a-zA-Z0-9-]/g, '-');
  const containerName = `nanoclaw-${safeName}-${Date.now()}`;
  const containerArgs = buildContainerArgs(mounts, containerName);

  const formatMount = (m: VolumeMount) =>
    `${m.hostPath} -> ${m.containerPath}${m.readonly ? ' (ro)' : ''}`;

  logger.info(
    {
      group: group.name,
      containerName,
      root: isRoot(group.folder),
      mounts: mounts.map(formatMount),
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

    if (input._annotations && input._annotations.length > 0) {
      input.prompt = `${input._annotations.join('\n')}\n\n${input.prompt}`;
    }
    delete input._annotations;

    const groupIpcDir = resolveGroupIpcPath(group.folder);
    const inputDir = path.join(groupIpcDir, 'input');
    try {
      for (const f of fs.readdirSync(inputDir)) {
        fs.unlinkSync(path.join(inputDir, f));
      }
    } catch {
      /* dir may not exist yet */
    }
    fs.mkdirSync(inputDir, { recursive: true });

    const grants = deriveRules(group.folder);
    const startJson = {
      sessionId: input.sessionId,
      groupFolder: input.groupFolder,
      chatJid: input.chatJid,
      assistantName: input.assistantName,
      channelName: input.channelName,
      secrets: readSecrets(),
      prompt: input.prompt,
      isScheduledTask: input.isScheduledTask,
      messageCount: input.messageCount,
      delegateDepth: input.delegateDepth,
      messageId: input.messageId,
      grants: grantOverrides ? [...grants, ...grantOverrides] : grants,
    };
    const startPath = path.join(groupIpcDir, 'start.json');
    const startTmp = `${startPath}.tmp`;
    fs.writeFileSync(startTmp, JSON.stringify(startJson));
    fs.renameSync(startTmp, startPath);

    container.stdin.end();

    let parseBuffer = '';
    let newSessionId: string | undefined;
    let outputChain = Promise.resolve();

    container.stdout.on('data', (data) => {
      const chunk = data.toString();
      const result = appendWithLimit(
        stdout,
        chunk,
        CONTAINER_MAX_OUTPUT_SIZE,
        stdoutTruncated,
      );
      if (result.truncated && !stdoutTruncated) {
        logger.warn(
          { group: group.name, size: result.buffer.length },
          'Container stdout truncated due to size limit',
        );
      }
      stdout = result.buffer;
      stdoutTruncated = result.truncated;

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
            if (parsed.newSessionId) {
              newSessionId = parsed.newSessionId;
            }
            hadStreamingOutput = true;
            resetTimeout();
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
      const result = appendWithLimit(
        stderr,
        chunk,
        CONTAINER_MAX_OUTPUT_SIZE,
        stderrTruncated,
      );
      if (result.truncated && !stderrTruncated) {
        logger.warn(
          { group: group.name, size: result.buffer.length },
          'Container stderr truncated due to size limit',
        );
      }
      stderr = result.buffer;
      stderrTruncated = result.truncated;
    });

    let timedOut = false;
    let hadStreamingOutput = false;
    const configTimeout = group.containerConfig?.timeout || CONTAINER_TIMEOUT;

    const killOnTimeout = () => {
      timedOut = true;
      logger.error(
        { group: group.name, containerName },
        'Container timeout, stopping gracefully',
      );
      const stopArgs = stopContainerArgs(containerName);
      const stop = spawn(CONTAINER_RUNTIME_BIN, stopArgs, {
        stdio: 'ignore',
        timeout: 15000,
      });
      stop.on('close', (code) => {
        if (code !== 0) {
          logger.warn(
            { group: group.name, containerName },
            'Graceful stop failed, force killing',
          );
          container.kill('SIGKILL');
        }
      });
      stop.on('error', () => container.kill('SIGKILL'));
    };

    let timeout = setTimeout(killOnTimeout, configTimeout);

    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(killOnTimeout, configTimeout);
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
          mounts.map(formatMount).join('\n'),
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

      try {
        const startIdx = stdout.indexOf(OUTPUT_START_MARKER);
        const endIdx = stdout.indexOf(OUTPUT_END_MARKER);

        let jsonLine: string;
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonLine = stdout
            .slice(startIdx + OUTPUT_START_MARKER.length, endIdx)
            .trim();
        } else {
          // Fallback: last non-empty line
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
    command?: string | null;
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

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

export function writeGroupsSnapshot(
  groupFolder: string,
  groups: AvailableGroup[],
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
