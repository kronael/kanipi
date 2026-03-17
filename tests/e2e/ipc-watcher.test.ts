/**
 * Integration tests for startIpcWatcher.
 *
 * Tests the full watcher loop: startup drain, poll-based group discovery,
 * and drain concurrency lock. Uses real fs (tmpdir) + vi.resetModules()
 * for per-test module-state isolation (ipcWatcherRunning, groupWatchers,
 * drainLocks are module-level singletons that must be reset between tests).
 *
 * Not mocked: fs
 * Mocked: config (per-test DATA_DIR), logger, commands/index
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Logger always mocked — suppress output.
vi.mock('../../src/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Prevent writeCommandsXml from writing to DATA_DIR stub paths.
vi.mock('../../src/commands/index.js', () => ({
  writeCommandsXml: vi.fn(),
  registerCommand: vi.fn(),
  findCommand: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
let ipcDir: string;

const ROOT_JID = 'root@g.us';

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    getHubForJid: (jid: string) => (jid === ROOT_JID ? 'root' : null),
    getJidsForFolder: (folder: string) => (folder === 'root' ? [ROOT_JID] : []),
    getRoutedJids: () => [ROOT_JID],
    getGroupConfig: (folder: string) =>
      folder === 'root'
        ? { name: 'Root', folder: 'root', trigger: 'always', added_at: '' }
        : undefined,
    getDirectChildGroupCount: (_folder: string) => 0,
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn().mockResolvedValue(undefined),
    getAvailableGroups: () => [],
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn().mockResolvedValue(undefined),
    delegateToParent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function writeRequest(group: string, payload: Record<string, unknown>): string {
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const reqDir = path.join(ipcDir, group, 'requests');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(
    path.join(reqDir, `${id}.json`),
    JSON.stringify({ id, ...payload }),
  );
  return id;
}

function readReply(group: string, id: string): Record<string, unknown> | null {
  const p = path.join(ipcDir, group, 'replies', `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** Flush the microtask queue without advancing fake timers. */
async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

// ── Per-test setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanipi-ipcw-'));
  ipcDir = path.join(tmpDir, 'ipc');
  fs.mkdirSync(ipcDir, { recursive: true });

  // vi.doMock (not vi.mock) runs after vi.resetModules so the dynamic import
  // in each test picks up the per-test DATA_DIR.
  vi.doMock('../../src/config.js', () => ({
    DATA_DIR: tmpDir,
    GROUPS_DIR: path.join(tmpDir, 'groups'),
    HOST_GROUPS_DIR: path.join(tmpDir, 'groups'),
    IPC_POLL_INTERVAL: 50,
    TIMEZONE: 'UTC',
    isRoot: (f: string) => !f.includes('/'),
    permissionTier: (f: string) =>
      f.includes('/') ? Math.min(f.split('/').length, 3) : 0,
  }));

  vi.doMock('../../src/grants.js', () => ({
    deriveRules: () => ['*'],
    getGrantOverrides: () => null,
    checkAction: () => true,
    matchingRules: (_rules: string[], _action: string) => ['*'],
  }));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('startIpcWatcher — startup drain', () => {
  it('drains pre-existing requests on startup', async () => {
    // Write a request before starting the watcher
    const id = writeRequest('root', { type: 'reset_session' });

    const deps = makeDeps();
    const { startIpcWatcher } = await import('../../src/ipc.js');
    startIpcWatcher(deps as never);

    // Flush microtask queue (startupDrain awaits are all sync fs under the hood)
    await flushMicrotasks();

    expect(deps.clearSession).toHaveBeenCalledWith('root');
    const reply = readReply('root', id);
    expect(reply?.ok).toBe(true);
  });

  it('drains multiple pre-existing group folders on startup', async () => {
    // scanGroupFolders walks recursively; any dir with a requests/ subdir is a group.
    writeRequest('groupA', { type: 'reset_session' });
    writeRequest('groupB', { type: 'reset_session' });

    const deps = makeDeps();
    const { startIpcWatcher } = await import('../../src/ipc.js');
    startIpcWatcher(deps as never);
    await flushMicrotasks(20);

    expect(deps.clearSession).toHaveBeenCalledTimes(2);
    expect(deps.clearSession).toHaveBeenCalledWith('groupA');
    expect(deps.clearSession).toHaveBeenCalledWith('groupB');
  });

  it('guard: second startIpcWatcher call is a no-op', async () => {
    const deps = makeDeps();
    const { startIpcWatcher } = await import('../../src/ipc.js');

    startIpcWatcher(deps as never);
    startIpcWatcher(deps as never); // should not throw or re-run startup drain

    await flushMicrotasks();
    // No crash; only one startup drain ran
    expect(deps.clearSession).not.toHaveBeenCalled();
  });
});

describe('startIpcWatcher — recursive folder scan', () => {
  it('discovers child group when parent group also has requests/', async () => {
    // Both parent and child have requests/ — the old else-branch would skip child
    writeRequest('parent', { type: 'reset_session' });
    writeRequest('parent/child', { type: 'reset_session' });

    const deps = makeDeps({
      getHubForJid: (_jid: string) => null,
      clearSession: vi.fn(),
    });
    const { startIpcWatcher } = await import('../../src/ipc.js');
    startIpcWatcher(deps as never);
    await flushMicrotasks(20);

    expect(deps.clearSession).toHaveBeenCalledTimes(2);
    expect(deps.clearSession).toHaveBeenCalledWith('parent');
    expect(deps.clearSession).toHaveBeenCalledWith('parent/child');
  });
});

describe('startIpcWatcher — poll-based group discovery', () => {
  it('poll discovers new group folder and drains its requests', async () => {
    const deps = makeDeps();
    const { startIpcWatcher } = await import('../../src/ipc.js');

    // Start with empty ipc dir — no groups yet
    startIpcWatcher(deps as never);
    await flushMicrotasks();
    expect(deps.clearSession).not.toHaveBeenCalled();

    // Add a new group folder + request AFTER watcher started
    const id = writeRequest('root', { type: 'reset_session' });

    // Advance by IPC_POLL_INTERVAL (50ms) to fire pollForNewGroups once,
    // then flush microtasks for the triggered drain.
    await vi.advanceTimersByTimeAsync(60);
    await flushMicrotasks();

    expect(deps.clearSession).toHaveBeenCalledWith('root');
    const reply = readReply('root', id);
    expect(reply?.ok).toBe(true);
  });

  it('poll does not re-drain groups already attached on startup', async () => {
    // Pre-seed group so startup drain processes it
    writeRequest('root', { type: 'reset_session' });

    const deps = makeDeps();
    const { startIpcWatcher } = await import('../../src/ipc.js');
    startIpcWatcher(deps as never);
    await flushMicrotasks();

    // clearSession called once for the startup request
    expect(deps.clearSession).toHaveBeenCalledTimes(1);

    // Advance past poll interval — no new groups, watcher is already attached
    await vi.advanceTimersByTimeAsync(60);
    await flushMicrotasks();

    // Still only 1 call — poll did not re-drain the already-watched group
    expect(deps.clearSession).toHaveBeenCalledTimes(1);
  });
});

describe('startIpcWatcher — drain concurrency lock', () => {
  it('concurrent _drainGroup calls for same group are serialized by lock', async () => {
    const deps = makeDeps();
    const { _drainGroup, drainRequests } = await import('../../src/ipc.js');

    // Write one request — second concurrent drain should not process it again
    const reqDir = path.join(ipcDir, 'root', 'requests');
    fs.mkdirSync(reqDir, { recursive: true });
    fs.writeFileSync(
      path.join(reqDir, 'req1.json'),
      JSON.stringify({ id: 'lock-test', type: 'reset_session' }),
    );

    // Fire two concurrent drains
    const p1 = _drainGroup(ipcDir, 'root', deps as never);
    const p2 = _drainGroup(ipcDir, 'root', deps as never);
    await Promise.all([p1, p2]);

    // Lock ensures only one drain ran — request consumed exactly once
    const repliesDir = path.join(ipcDir, 'root', 'replies');
    const replies = fs.existsSync(repliesDir) ? fs.readdirSync(repliesDir) : [];
    expect(replies).toHaveLength(1);
    void drainRequests; // used in import
  });
});
