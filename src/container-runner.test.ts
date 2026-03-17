import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// Sentinel markers must match container-runner.ts
const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

// Mock config
vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  DATA_DIR: '/tmp/nanoclaw-test-data',
  GROUPS_DIR: '/tmp/nanoclaw-test-groups',
  HOST_APP_DIR: '/tmp/nanoclaw-test-app',
  HOST_DATA_DIR: '/tmp/nanoclaw-test-root/data',
  HOST_GROUPS_DIR: '/tmp/nanoclaw-test-root/groups',
  HOST_WEB_DIR: '/tmp/nanoclaw-test-root/web',
  TIMEZONE: 'America/Los_Angeles',
  WEB_DIR: '/tmp/nanoclaw-test-web',
  WEB_HOST: '',
  isRoot: (f: string) => !f.includes('/'),
  permissionTier: (f: string) =>
    f.includes('/') ? Math.min(f.split('/').length, 3) : 0,
  MEDIA_ENABLED: false,
  MEDIA_MAX_FILE_BYTES: 10485760,
  VIDEO_TRANSCRIPTION_ENABLED: false,
  VOICE_TRANSCRIPTION_ENABLED: false,
  WHISPER_BASE_URL: 'http://localhost:8080',
  WHISPER_MODEL: 'base',
}));

// Mock db (container-runner now calls recordSessionStart/updateSessionEnd)
vi.mock('./db.js', () => ({
  recordSessionStart: vi.fn(),
  updateSessionEnd: vi.fn(),
}));

// Mock grants (container-runner calls deriveRules/getGrantOverrides)
vi.mock('./grants.js', () => ({
  deriveRules: () => ['*'],
  getGrantOverrides: () => null,
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => '{}'),
      readdirSync: vi.fn(() => []),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
      copyFileSync: vi.fn(),
      cpSync: vi.fn(),
      renameSync: vi.fn(),
      unlinkSync: vi.fn(),
      chownSync: vi.fn(),
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
}));

// Mock grants (container-runner calls deriveRules + getGrantOverrides)
vi.mock('./grants.js', () => ({
  deriveRules: vi.fn(() => ['*']),
  getGrantOverrides: vi.fn(() => null),
}));

// Create a controllable fake ChildProcess
function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

let fakeProc: ReturnType<typeof createFakeProcess>;

// Mock child_process.spawn
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(
      (_cmd: string, _args: string[], opts?: { stdio?: unknown }) => {
        const isIgnored =
          opts?.stdio === 'ignore' ||
          (Array.isArray(opts?.stdio) && opts.stdio[0] === 'ignore');
        if (isIgnored) {
          const p = new EventEmitter() as EventEmitter & { pid: number };
          p.pid = 99999;
          process.nextTick(() => p.emit('close', 0));
          return p;
        }
        return fakeProc;
      },
    ),
  };
});

import { runContainerCommand, ContainerOutput } from './container-runner.js';
import type { GroupConfig } from './db.js';

const testGroup: GroupConfig = {
  name: 'Test Group',
  folder: 'test-group',
  added_at: new Date().toISOString(),
};

const testInput = {
  prompt: 'Hello',
  groupFolder: 'test-group',
  chatJid: 'test@g.us',
};

function emitOutputMarker(
  proc: ReturnType<typeof createFakeProcess>,
  output: ContainerOutput,
) {
  const json = JSON.stringify(output);
  proc.stdout.push(`${OUTPUT_START_MARKER}\n${json}\n${OUTPUT_END_MARKER}\n`);
}

async function closeAndAwait(
  promise: Promise<ContainerOutput>,
  code = 1,
): Promise<ContainerOutput> {
  fakeProc.emit('close', code);
  await vi.advanceTimersByTimeAsync(10);
  return promise;
}

// Shared setup for all describe blocks using fake timers
beforeEach(() => {
  vi.useFakeTimers();
  fakeProc = createFakeProcess();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('container-runner timeout behavior', () => {
  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerCommand(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output with a result
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Here is my response',
      newSessionId: 'session-123',
    });

    // Let output processing settle
    await vi.advanceTimersByTimeAsync(10);

    // Fire the hard timeout (CONTAINER_TIMEOUT = 1800000ms)
    await vi.advanceTimersByTimeAsync(1800000);

    // Emit close event (as if container was stopped by the timeout)
    fakeProc.emit('close', 137);

    // Let the promise resolve
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-123');
    expect(onOutput).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'Here is my response' }),
    );
  });

  it('timeout with no output resolves as error', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerCommand(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // No output emitted — fire the hard timeout
    await vi.advanceTimersByTimeAsync(1830000);

    // Emit close event
    fakeProc.emit('close', 137);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('timed out');
    expect(onOutput).not.toHaveBeenCalled();
  });

  it('normal exit after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerCommand(
      testGroup,
      testInput,
      () => {},
      onOutput,
    );

    // Emit output
    emitOutputMarker(fakeProc, {
      status: 'success',
      result: 'Done',
      newSessionId: 'session-456',
    });

    await vi.advanceTimersByTimeAsync(10);

    // Normal exit (no timeout)
    fakeProc.emit('close', 0);

    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.newSessionId).toBe('session-456');
  });
});

describe('volume mount paths for nested folders', () => {
  it('nested folder gets correct .claude host mount path', async () => {
    const cp = await import('child_process');
    const fs = await import('fs');
    vi.mocked(fs.default.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.endsWith('/prototype')) return true;
      return false;
    });

    const nestedGroup: GroupConfig = {
      name: 'Atlas Support',
      folder: 'atlas/support',
      added_at: new Date().toISOString(),
    };

    const resultPromise = runContainerCommand(
      nestedGroup,
      { prompt: 'test', groupFolder: 'atlas/support', chatJid: 'test@g.us' },
      () => {},
    );

    // Let spawn happen
    await vi.advanceTimersByTimeAsync(10);

    // Get the docker run args from the spawn call
    const spawnCalls = vi.mocked(cp.spawn).mock.calls;
    const agentCall = spawnCalls.find(
      (c) =>
        Array.isArray(c[1]) &&
        c[1].some(
          (a: string) => typeof a === 'string' && a.includes('nanoclaw-atlas'),
        ),
    );
    expect(agentCall).toBeDefined();
    const args = agentCall![1] as string[];

    // Find the /home/node mount — should use HOST_GROUPS_DIR
    const homeMount = args.find(
      (a) => typeof a === 'string' && a.includes(':/home/node'),
    );
    expect(homeMount).toBeDefined();
    // Verify host path uses HOST_GROUPS_DIR translation
    expect(homeMount).toContain('groups/atlas/support:/home/node');

    await closeAndAwait(resultPromise);
  });
});

describe('unified home mount behavior', () => {
  async function getAgentArgs(): Promise<string[]> {
    const cp = await import('child_process');
    const calls = vi.mocked(cp.spawn).mock.calls;
    const agentCalls = calls.filter(
      (c) =>
        Array.isArray(c[1]) &&
        c[1].some(
          (a: string) => typeof a === 'string' && a.includes('nanoclaw-agent'),
        ),
    );
    const last = agentCalls[agentCalls.length - 1];
    return last ? (last[1] as string[]) : [];
  }

  it('mounts group folder as /home/node (not /workspace/group)', async () => {
    const resultPromise = runContainerCommand(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(10);

    const args = await getAgentArgs();
    const homeMount = args.find(
      (a) => typeof a === 'string' && a.includes(':/home/node'),
    );
    expect(homeMount).toBeDefined();
    // No /workspace/group mount
    const oldMount = args.find(
      (a) => typeof a === 'string' && a.includes('/workspace/group'),
    );
    expect(oldMount).toBeUndefined();

    await closeAndAwait(resultPromise);
  });

  it('tier 3 group gets RO home with RW .claude overlay', async () => {
    const tier3Group: GroupConfig = {
      name: 'Deep Child',
      folder: 'world/a/b/c',
      added_at: new Date().toISOString(),
    };

    const resultPromise = runContainerCommand(
      tier3Group,
      { prompt: 'test', groupFolder: 'world/a/b/c', chatJid: 'test@g.us' },
      () => {},
    );
    await vi.advanceTimersByTimeAsync(10);

    const args = await getAgentArgs();

    // Home mount should be read-only (tier 3)
    const homeRelated = args.filter(
      (a) => typeof a === 'string' && a.includes('/home/node'),
    );
    // At least one RO mount for /home/node and one RW for /home/node/.claude
    const roHome = homeRelated.some(
      (a) => a.includes(':/home/node:ro') || a.includes('/home/node,readonly'),
    );
    expect(roHome).toBe(true);

    // RW overlays for .claude/projects, media, tmp
    for (const d of ['.claude/projects', 'media', 'tmp']) {
      const mount = args.find(
        (a) => typeof a === 'string' && a.includes(`/home/node/${d}`),
      );
      expect(mount, `${d} should be mounted`).toBeDefined();
      expect(mount, `${d} should be RW`).not.toContain(':ro');
    }

    // No full .claude/ RW mount
    const fullClaudeMount = args.find(
      (a) =>
        typeof a === 'string' &&
        a.includes('/home/node/.claude') &&
        !a.includes('/home/node/.claude/projects'),
    );
    expect(fullClaudeMount).toBeUndefined();

    await closeAndAwait(resultPromise);
  });

  it('root tier 0 gets ~/groups mount', async () => {
    const rootGroup: GroupConfig = {
      name: 'Root',
      folder: 'root',
      added_at: new Date().toISOString(),
    };

    const resultPromise = runContainerCommand(
      rootGroup,
      { prompt: 'test', groupFolder: 'root', chatJid: 'test@g.us' },
      () => {},
    );
    await vi.advanceTimersByTimeAsync(10);

    const args = await getAgentArgs();
    const groupsMount = args.find(
      (a) => typeof a === 'string' && a.includes(':/home/node/groups'),
    );
    expect(groupsMount).toBeDefined();

    await closeAndAwait(resultPromise);
  });

  it('seeds output-styles from source into .claude/', async () => {
    const fs = await import('fs');
    vi.mocked(fs.default.existsSync).mockImplementation((p) => {
      const s = String(p);
      if (s.includes('output-styles')) return true;
      return false;
    });

    const resultPromise = runContainerCommand(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(10);

    // Verify cpSync was called for output-styles
    expect(vi.mocked(fs.default.cpSync)).toHaveBeenCalledWith(
      expect.stringContaining('output-styles'),
      expect.stringContaining('.claude/output-styles'),
      { recursive: true },
    );

    await closeAndAwait(resultPromise);
  });

  it('no separate media mount (media inside home)', async () => {
    const resultPromise = runContainerCommand(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(10);

    const args = await getAgentArgs();
    // No /workspace/media mount
    const mediaMount = args.find(
      (a) => typeof a === 'string' && a.includes('/workspace/media'),
    );
    expect(mediaMount).toBeUndefined();

    await closeAndAwait(resultPromise);
  });
});

describe('runContainerCommand input validation', () => {
  it('throws when agent mode receives string input', async () => {
    await expect(
      runContainerCommand(testGroup, 'string input', () => {}),
    ).rejects.toThrow('agent mode requires ContainerInput object');
  });
});

describe('container spawn error', () => {
  it('resolves with error on spawn failure', async () => {
    const resultPromise = runContainerCommand(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(10);

    fakeProc.emit('error', new Error('ENOENT: command not found'));
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('spawn error');
    expect(result.error).toContain('ENOENT');
  });
});

describe('container non-zero exit without streaming', () => {
  it('returns error with stderr excerpt', async () => {
    const resultPromise = runContainerCommand(testGroup, testInput, () => {});
    await vi.advanceTimersByTimeAsync(10);

    fakeProc.stderr.push('fatal: something went wrong\n');
    fakeProc.emit('close', 1);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('code 1');
    expect(result.error).toContain('something went wrong');
  });
});

describe('raw command mode', () => {
  it('skips agent ceremony and captures stdout as result', async () => {
    const db = await import('./db.js');
    vi.mocked(db.recordSessionStart).mockClear();

    const resultPromise = runContainerCommand(
      testGroup,
      'input text',
      () => {},
      undefined,
      ['bash', '-c', 'echo hello'],
    );

    await vi.advanceTimersByTimeAsync(10);

    // Emit stdout
    fakeProc.stdout.push('hello world\n');

    // Exit successfully
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.result).toBe('hello world');

    // Should NOT have called recordSessionStart (no session tracking)
    expect(db.recordSessionStart).not.toHaveBeenCalled();
  });

  it('returns error on non-zero exit code', async () => {
    const resultPromise = runContainerCommand(
      testGroup,
      '',
      () => {},
      undefined,
      ['bash', '-c', 'exit 1'],
    );

    await vi.advanceTimersByTimeAsync(10);

    fakeProc.stderr.push('command failed\n');
    fakeProc.emit('close', 1);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('code 1');
  });

  it('returns error on raw command spawn error', async () => {
    const resultPromise = runContainerCommand(
      testGroup,
      'input',
      () => {},
      undefined,
      ['bash', '-c', 'fail'],
    );

    await vi.advanceTimersByTimeAsync(10);

    fakeProc.emit('error', new Error('spawn ENOENT'));
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('spawn error');
  });

  it('returns null result on empty stdout', async () => {
    const resultPromise = runContainerCommand(
      testGroup,
      '',
      () => {},
      undefined,
      ['bash', '-c', 'true'],
    );

    await vi.advanceTimersByTimeAsync(10);

    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(result.result).toBeNull();
  });

  it('passes command array to buildContainerArgs', async () => {
    const cp = await import('child_process');
    vi.mocked(cp.spawn).mockClear();

    const resultPromise = runContainerCommand(
      testGroup,
      '',
      () => {},
      undefined,
      ['bash', '-c', 'git pull'],
    );

    await vi.advanceTimersByTimeAsync(10);

    const spawnCalls = vi.mocked(cp.spawn).mock.calls;
    const call = spawnCalls.find(
      (c) => Array.isArray(c[1]) && c[1].some((a: string) => a === 'bash'),
    );
    expect(call).toBeDefined();
    const args = call![1] as string[];
    // Command should appear after image name
    const imgIdx = args.indexOf('nanoclaw-agent:latest');
    expect(imgIdx).toBeGreaterThan(-1);
    expect(args[imgIdx + 1]).toBe('bash');
    expect(args[imgIdx + 2]).toBe('-c');
    expect(args[imgIdx + 3]).toBe('git pull');

    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);
    await resultPromise;
  });
});
