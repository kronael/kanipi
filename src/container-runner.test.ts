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
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: vi.fn(() => fakeProc),
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

import { runContainerAgent, ContainerOutput } from './container-runner.js';
import type { RegisteredGroup } from './types.js';

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
    vi.mocked(cp.exec).mockImplementationOnce(
      (_cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        // Fail the sidecar docker run
        if (callback) callback(new Error('docker: image not found'));
        return new EventEmitter();
      },
    );

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
    const cp = await import('child_process');
    // exec succeeds for sidecar docker run
    vi.mocked(cp.exec).mockImplementationOnce(
      (_cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        if (callback) callback(null); // docker run succeeds
        return new EventEmitter();
      },
    );

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
    vi.useFakeTimers();
    fakeProc = createFakeProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stop is called for sidecars when agent exits normally', async () => {
    const cp = await import('child_process');
    const fs = await import('fs');

    // Make sidecar start succeed: exec resolves, socket appears, probe connects
    vi.mocked(cp.exec).mockImplementation(
      (_cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        if (callback) callback(null);
        return new EventEmitter();
      },
    );
    // existsSync: return true for .sock paths so waitForSocket resolves
    vi.mocked(fs.default.existsSync).mockImplementation(
      (p: unknown) => typeof p === 'string' && p.endsWith('.sock'),
    );

    const stopCalls: string[] = [];
    vi.mocked(cp.exec).mockImplementation(
      (cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        if (String(cmd).includes(' stop ')) stopCalls.push(String(cmd));
        if (callback) callback(null);
        return new EventEmitter();
      },
    );

    const onOutput = vi.fn(async () => {});
    const resultPromise = runContainerAgent(
      sidecarGroup,
      { ...testInput, groupFolder: 'sidecar-group' },
      () => {},
      onOutput,
    );

    // net mock: probeSidecar connects via setTimeout(0) — advance timers a bit
    await vi.advanceTimersByTimeAsync(10);

    // Agent has spawned, emit output and close
    emitOutputMarker(fakeProc, { status: 'success', result: 'done' });
    await vi.advanceTimersByTimeAsync(10);
    fakeProc.emit('close', 0);
    await vi.advanceTimersByTimeAsync(10);

    await resultPromise;
    // stopSidecars called with the sidecar container name
    expect(
      stopCalls.some((c) => c.includes('stop') && c.includes('sidecar')),
    ).toBe(true);
  });

  it('stop is called for sidecars when agent exits with error', async () => {
    const cp = await import('child_process');
    const fs = await import('fs');

    vi.mocked(cp.exec).mockImplementation(
      (_cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        if (callback) callback(null);
        return new EventEmitter();
      },
    );
    vi.mocked(fs.default.existsSync).mockImplementation(
      (p: unknown) => typeof p === 'string' && p.endsWith('.sock'),
    );

    const stopCalls: string[] = [];
    vi.mocked(cp.exec).mockImplementation(
      (cmd: string, optsOrCb: unknown, cb?: (err: Error | null) => void) => {
        const callback =
          typeof optsOrCb === 'function'
            ? (optsOrCb as (err: Error | null) => void)
            : cb;
        if (String(cmd).includes(' stop ')) stopCalls.push(String(cmd));
        if (callback) callback(null);
        return new EventEmitter();
      },
    );

    const resultPromise = runContainerAgent(
      sidecarGroup,
      { ...testInput, groupFolder: 'sidecar-group' },
      () => {},
    );

    await vi.advanceTimersByTimeAsync(10);

    // Agent exits with non-zero code
    fakeProc.emit('close', 1);
    await vi.advanceTimersByTimeAsync(10);

    const result = await resultPromise;
    expect(result.status).toBe('error');
    expect(
      stopCalls.some((c) => c.includes('stop') && c.includes('sidecar')),
    ).toBe(true);
  });
});
