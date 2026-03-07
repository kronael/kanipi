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
  HOST_PROJECT_ROOT_PATH: '/tmp/nanoclaw-test-root',
  IDLE_TIMEOUT: 1800000,
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
  WHISPER_MODEL: 'base',
}));

// Mock db (container-runner now calls recordSessionStart/updateSessionEnd)
vi.mock('./db.js', () => ({
  recordSessionStart: vi.fn(),
  updateSessionEnd: vi.fn(),
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
    },
  };
});

// Mock mount-security
vi.mock('./mount-security.js', () => ({
  validateAdditionalMounts: vi.fn(() => []),
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
// Agent spawn (stdio: pipe) returns fakeProc; sidecar spawn (stdio: ignore)
// returns a short-lived process that exits immediately with code 0.
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
    // Handle both exec(cmd, cb) and exec(cmd, opts, cb) call forms
    exec: vi.fn(
      (_cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        if (callback) callback(null);
        return new EventEmitter();
      },
    ),
  };
});

// Mock net (used by probeSidecar)
vi.mock('net', async () => {
  const actual = await vi.importActual<typeof import('net')>('net');
  return {
    ...actual,
    default: {
      ...actual,
      createConnection: vi.fn(() => {
        const sock = new EventEmitter() as EventEmitter & {
          destroy: ReturnType<typeof vi.fn>;
        };
        sock.destroy = vi.fn();
        // emit 'connect' immediately so probe succeeds
        setTimeout(() => sock.emit('connect'), 0);
        return sock;
      }),
    },
  };
});

import {
  runContainerAgent,
  reconcileSidecarSettings,
  ContainerOutput,
} from './container-runner.js';
import type { RegisteredGroup, SidecarHandle } from './types.js';

const testGroup: RegisteredGroup = {
  name: 'Test Group',
  folder: 'test-group',
  trigger: '@Andy',
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

describe('container-runner timeout behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout after output resolves as success', async () => {
    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
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

    // Fire the hard timeout (IDLE_TIMEOUT + 30s = 1830000ms)
    await vi.advanceTimersByTimeAsync(1830000);

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
    const resultPromise = runContainerAgent(
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
    const resultPromise = runContainerAgent(
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

// --- Sidecar lifecycle ---

const sidecarGroup: RegisteredGroup = {
  name: 'Sidecar Group',
  folder: 'sidecar-group',
  trigger: '@Andy',
  added_at: new Date().toISOString(),
  containerConfig: {
    sidecars: {
      websearch: { image: 'kanipi-sidecar-websearch:latest', network: 'none' },
    },
  },
};

describe('sidecar startup failure fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('agent still runs when sidecar docker run fails', async () => {
    const cp = await import('child_process');
    // First spawn call is for sidecar (stdio: ignore) — make it fail
    vi.mocked(cp.spawn).mockImplementationOnce(() => {
      const p = new EventEmitter() as EventEmitter & { pid: number };
      p.pid = 99999;
      process.nextTick(() =>
        p.emit('error', new Error('docker: image not found')),
      );
      return p as ReturnType<typeof cp.spawn>;
    });

    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      sidecarGroup,
      { ...testInput, groupFolder: 'sidecar-group' },
      () => {},
      onOutput,
    );

    // Let sidecar failure propagate
    await vi.advanceTimersByTimeAsync(10);

    // Agent should have spawned despite sidecar failure
    emitOutputMarker(fakeProc, { status: 'success', result: 'ok' });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
    expect(onOutput).toHaveBeenCalled();
  });

  it('agent still runs when sidecar socket never appears (timeout)', async () => {
    // fs.existsSync returns false → socket never appears → waitForSocket times out
    const fs = await import('fs');
    vi.mocked(fs.default.existsSync).mockReturnValue(false);

    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      sidecarGroup,
      { ...testInput, groupFolder: 'sidecar-group' },
      () => {},
      onOutput,
    );

    // Advance 5100ms so waitForSocket times out (5000ms deadline)
    await vi.advanceTimersByTimeAsync(5100);
    await vi.advanceTimersByTimeAsync(10);

    // Agent spawned after sidecar timed out
    emitOutputMarker(fakeProc, { status: 'success', result: 'ok' });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('success');
  });
});

describe('sidecar cleanup behavior', () => {
  beforeEach(() => {
    fakeProc = createFakeProcess();
  });

  it('stop is called for sidecars when agent exits normally', async () => {
    const cp = await import('child_process');
    const fs = await import('fs');

    vi.mocked(fs.default.existsSync).mockImplementation(
      (p: unknown) => typeof p === 'string' && p.endsWith('.sock'),
    );

    const stopArgs: string[][] = [];
    vi.mocked(cp.spawn).mockImplementation(
      (_cmd: string, args: string[], opts?: { stdio?: unknown }) => {
        const isIgnored =
          opts?.stdio === 'ignore' ||
          (Array.isArray(opts?.stdio) && opts.stdio[0] === 'ignore');
        if (isIgnored) {
          if (args.includes('stop')) stopArgs.push(args);
          const p = new EventEmitter() as EventEmitter & { pid: number };
          p.pid = 99999;
          process.nextTick(() => p.emit('close', 0));
          return p as ReturnType<typeof cp.spawn>;
        }
        return fakeProc as ReturnType<typeof cp.spawn>;
      },
    );

    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      sidecarGroup,
      { ...testInput, groupFolder: 'sidecar-group' },
      () => {},
      onOutput,
    );

    // Wait for sidecar startup (probeSidecar uses setTimeout)
    await new Promise((r) => setTimeout(r, 50));

    emitOutputMarker(fakeProc, { status: 'success', result: 'done' });
    await new Promise((r) => setTimeout(r, 10));
    fakeProc.emit('close', 0);

    await resultPromise;
    expect(
      stopArgs.some(
        (a) => a.includes('stop') && a.some((x) => x.includes('sidecar')),
      ),
    ).toBe(true);
  });

  it('stop is called for sidecars when agent exits with error', async () => {
    const cp = await import('child_process');
    const fs = await import('fs');

    vi.mocked(fs.default.existsSync).mockImplementation(
      (p: unknown) => typeof p === 'string' && p.endsWith('.sock'),
    );

    const stopArgs: string[][] = [];
    vi.mocked(cp.spawn).mockImplementation(
      (_cmd: string, args: string[], opts?: { stdio?: unknown }) => {
        const isIgnored =
          opts?.stdio === 'ignore' ||
          (Array.isArray(opts?.stdio) && opts.stdio[0] === 'ignore');
        if (isIgnored) {
          if (args.includes('stop')) stopArgs.push(args);
          const p = new EventEmitter() as EventEmitter & { pid: number };
          p.pid = 99999;
          process.nextTick(() => p.emit('close', 0));
          return p as ReturnType<typeof cp.spawn>;
        }
        return fakeProc as ReturnType<typeof cp.spawn>;
      },
    );

    const resultPromise = runContainerAgent(
      sidecarGroup,
      { ...testInput, groupFolder: 'sidecar-group' },
      () => {},
    );

    await new Promise((r) => setTimeout(r, 50));
    fakeProc.emit('close', 1);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(
      stopArgs.some(
        (a) => a.includes('stop') && a.some((x) => x.includes('sidecar')),
      ),
    ).toBe(true);
  });
});

// --- reconcileSidecarSettings unit tests ---

const SETTINGS_PATH = '/fake/settings.json';

function makeHandle(specName: string, allowedTools?: string[]): SidecarHandle {
  return {
    containerName: `nanoclaw-sidecar-${specName}-grp`,
    specName,
    sockPath: `/run/socks/${specName}.sock`,
    allowedTools,
  };
}

describe('reconcileSidecarSettings', () => {
  let store: Record<string, string>;

  beforeEach(async () => {
    store = {};
    const fs = await import('fs');
    vi.mocked(fs.default.readFileSync).mockImplementation((p: unknown) => {
      const key = String(p);
      return store[key] ?? '{}';
    });
    vi.mocked(fs.default.writeFileSync).mockImplementation(
      (p: unknown, data: unknown) => {
        store[String(p)] = String(data);
      },
    );
  });

  function read(): Record<string, unknown> {
    return JSON.parse(store[SETTINGS_PATH] ?? '{}');
  }

  it('add: injects mcpServers and allowedTools for active handles', () => {
    reconcileSidecarSettings(SETTINGS_PATH, [makeHandle('websearch')]);

    const s = read();
    expect(s.mcpServers).toHaveProperty('websearch');
    expect(s.allowedTools).toContain('mcp__websearch__*');
    expect(s._managedSidecars).toEqual(['websearch']);
  });

  it('add with restricted tools: injects per-tool allowedTools entries', () => {
    reconcileSidecarSettings(SETTINGS_PATH, [
      makeHandle('code', ['run', 'lint']),
    ]);

    const s = read();
    expect(s.allowedTools).toContain('mcp__code__run');
    expect(s.allowedTools).toContain('mcp__code__lint');
    expect(s.allowedTools).not.toContain('mcp__code__*');
  });

  it('update: replaces mcpServers entry and refreshes allowedTools', () => {
    // First run: websearch with wildcard tools
    reconcileSidecarSettings(SETTINGS_PATH, [makeHandle('websearch')]);

    // Second run: websearch with restricted tools
    reconcileSidecarSettings(SETTINGS_PATH, [
      makeHandle('websearch', ['search']),
    ]);

    const s = read();
    expect(s.allowedTools).toContain('mcp__websearch__search');
    expect(s.allowedTools).not.toContain('mcp__websearch__*');
    // No duplicates
    const entries = (s.allowedTools as string[]).filter((t) =>
      t.startsWith('mcp__websearch__'),
    );
    expect(entries.length).toBe(1);
  });

  it('remove: purges mcpServers and allowedTools when sidecar is removed', () => {
    // First run: sidecar present
    reconcileSidecarSettings(SETTINGS_PATH, [makeHandle('websearch')]);
    expect(read().mcpServers).toHaveProperty('websearch');

    // Second run: sidecar removed (empty handles)
    reconcileSidecarSettings(SETTINGS_PATH, []);

    const s = read();
    expect(s.mcpServers).not.toHaveProperty('websearch');
    const tools = (s.allowedTools ?? []) as string[];
    expect(tools.filter((t) => t.startsWith('mcp__websearch__'))).toHaveLength(
      0,
    );
    expect(s._managedSidecars).toEqual([]);
  });

  it('idempotent: running twice with same config produces identical settings', () => {
    const h = makeHandle('websearch');
    reconcileSidecarSettings(SETTINGS_PATH, [h]);
    const first = store[SETTINGS_PATH];

    reconcileSidecarSettings(SETTINGS_PATH, [h]);
    const second = store[SETTINGS_PATH];

    expect(second).toBe(first);
  });

  it('preserves non-sidecar mcpServers and allowedTools entries', () => {
    store[SETTINGS_PATH] = JSON.stringify({
      mcpServers: { myTool: { command: 'mytool', args: [] } },
      allowedTools: ['Bash', 'Read'],
    });

    reconcileSidecarSettings(SETTINGS_PATH, [makeHandle('websearch')]);

    const s = read();
    expect(s.mcpServers).toHaveProperty('myTool');
    expect(s.allowedTools).toContain('Bash');
    expect(s.allowedTools).toContain('Read');
    expect(s.allowedTools).toContain('mcp__websearch__*');
  });

  it('remove: does not affect non-sidecar entries', () => {
    store[SETTINGS_PATH] = JSON.stringify({
      mcpServers: {
        myTool: { command: 'mytool', args: [] },
        websearch: { command: 'socat', args: [] },
      },
      allowedTools: ['Bash', 'mcp__websearch__*'],
      _managedSidecars: ['websearch'],
    });

    reconcileSidecarSettings(SETTINGS_PATH, []);

    const s = read();
    expect(s.mcpServers).toHaveProperty('myTool');
    expect(s.mcpServers).not.toHaveProperty('websearch');
    expect(s.allowedTools).toContain('Bash');
    const tools = (s.allowedTools as string[]).filter((t) =>
      t.startsWith('mcp__websearch__'),
    );
    expect(tools).toHaveLength(0);
  });
});
