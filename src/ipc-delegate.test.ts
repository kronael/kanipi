/**
 * Integration tests for delegate_group IPC flow.
 * Uses real IPC request/reply files on disk and DB-backed routing.
 * Only the container boundary (delegateToChild) is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import { drainRequests, _drainGroup, IpcDeps } from './ipc.js';
// Register all actions (side-effect)
import './ipc.js';
import {
  _initTestDatabase,
  _setTestGroupRoute,
  getHubForJid,
  getJidsForFolder,
  getRoutedJids,
  GroupConfig,
} from './db.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ROOT: GroupConfig = {
  name: 'Root',
  folder: 'root',
  added_at: '2024-01-01T00:00:00.000Z',
};

const CODE: GroupConfig = {
  name: 'Code',
  folder: 'root/code',
  added_at: '2024-01-01T00:00:00.000Z',
};

const LOGS: GroupConfig = {
  name: 'Logs',
  folder: 'root/logs',
  added_at: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TMP_BASE = path.resolve('./tmp');
let tmpDir: string;
let delegateToChild: ReturnType<typeof vi.fn>;
let delegateToParent: ReturnType<typeof vi.fn>;
let deps: IpcDeps;

beforeEach(() => {
  _initTestDatabase();
  fs.mkdirSync(TMP_BASE, { recursive: true });
  tmpDir = fs.mkdtempSync(path.join(TMP_BASE, 'ipc-delegate-'));

  delegateToChild = vi.fn(async () => {});
  delegateToParent = vi.fn(async () => {});

  deps = {
    sendMessage: vi.fn(async () => {}),
    sendDocument: vi.fn(async () => {}),
    getHubForJid,
    getJidsForFolder,
    getRoutedJids,
    getGroupConfig: vi.fn((_folder: string) => undefined),
    getDirectChildGroupCount: vi.fn(() => 0),
    registerGroup: (jid, group) => _setTestGroupRoute(jid, group),
    syncGroupMetadata: vi.fn(async () => {}),
    getAvailableGroups: vi.fn(() => []),
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild,
    delegateToParent,
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeRequest(sourceGroup: string, req: Record<string, unknown>): void {
  const dir = path.join(tmpDir, sourceGroup, 'requests');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${req.id as string}.json`),
    JSON.stringify(req),
  );
}

function readReply(
  sourceGroup: string,
  id: string,
): { id: string; ok: boolean; result?: unknown; error?: string } | null {
  const file = path.join(tmpDir, sourceGroup, 'replies', `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ---------------------------------------------------------------------------
// delegate_group: real IPC files
// ---------------------------------------------------------------------------

describe('delegate_group IPC — real files', () => {
  it('authorized parent→child: writes ok reply, calls delegateToChild', async () => {
    _setTestGroupRoute('root@g.us', ROOT);
    _setTestGroupRoute('child@g.us', CODE);

    writeRequest('root', {
      id: 'req-1',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'fix the bug',
      chatJid: 'tg/-100',
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-1');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(true);
    expect(reply!.result).toEqual({ queued: true });
    expect(delegateToChild).toHaveBeenCalledOnce();
    expect(delegateToChild).toHaveBeenCalledWith(
      'root/code',
      'fix the bug',
      'tg/-100',
      1,
      undefined,
    );
  });

  it('root world sibling delegation: allowed (root world privilege)', async () => {
    _setTestGroupRoute('root@g.us', ROOT);
    _setTestGroupRoute('logs@g.us', LOGS);

    writeRequest('root/code', {
      id: 'req-sibling',
      type: 'delegate_group',
      group: 'root/logs',
      prompt: 'check logs',
      chatJid: 'tg/-100',
    });

    await drainRequests(tmpDir, 'root/code', deps);

    const reply = readReply('root/code', 'req-sibling');
    expect(reply!.ok).toBe(true);
    expect(reply!.result).toEqual({ queued: true });
    expect(delegateToChild).toHaveBeenCalledOnce();
  });

  it('non-root sibling delegation: denied', async () => {
    const ATLAS: GroupConfig = {
      name: 'Atlas',
      folder: 'atlas',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    const ATLAS_A: GroupConfig = {
      name: 'Atlas A',
      folder: 'atlas/a',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    _setTestGroupRoute('atlas@g.us', ATLAS);
    _setTestGroupRoute('atlas-a@g.us', ATLAS_A);

    writeRequest('atlas/a', {
      id: 'req-sibling-nr',
      type: 'delegate_group',
      group: 'atlas/b',
      prompt: 'check',
      chatJid: 'tg/-100',
    });

    await drainRequests(tmpDir, 'atlas/a', deps);

    const reply = readReply('atlas/a', 'req-sibling-nr');
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toMatch(/unauthorized/i);
    expect(delegateToChild).not.toHaveBeenCalled();
  });

  it('grandchild delegation (skipping a level): writes ok reply', async () => {
    writeRequest('root', {
      id: 'req-grandchild',
      type: 'delegate_group',
      group: 'root/code/py',
      prompt: 'lint',
      chatJid: 'tg/-100',
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-grandchild');
    expect(reply!.ok).toBe(true);
    expect(reply!.result).toEqual({ queued: true });
    expect(delegateToChild).toHaveBeenCalledOnce();
  });

  it('depth limit exceeded: writes error reply', async () => {
    writeRequest('root', {
      id: 'req-depth',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'do it',
      chatJid: 'tg/-100',
      depth: 3,
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-depth');
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toMatch(/depth/i);
    expect(delegateToChild).not.toHaveBeenCalled();
  });

  it('explicit depth 0 delegates and passes depth 1 to child', async () => {
    _setTestGroupRoute('root@g.us', ROOT);

    writeRequest('root', {
      id: 'req-d0',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'start',
      chatJid: 'tg/-100',
      depth: 0,
    });

    await drainRequests(tmpDir, 'root', deps);

    expect(delegateToChild).toHaveBeenCalledWith(
      'root/code',
      'start',
      'tg/-100',
      1,
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// DB-backed registeredGroups: live reads
// ---------------------------------------------------------------------------

describe('DB-backed routing — live reads', () => {
  it('delegate from non-root parent uses correct child path check', async () => {
    // main/code delegates to main/code/py — direct child, should succeed
    _setTestGroupRoute('root@g.us', ROOT);
    _setTestGroupRoute('child@g.us', CODE);

    writeRequest('root/code', {
      id: 'req-nested',
      type: 'delegate_group',
      group: 'root/code/py',
      prompt: 'run tests',
      chatJid: 'tg/-100',
      depth: 0,
    });

    await drainRequests(tmpDir, 'root/code', deps);

    const reply = readReply('root/code', 'req-nested');
    expect(reply!.ok).toBe(true);
    expect(delegateToChild).toHaveBeenCalledWith(
      'root/code/py',
      'run tests',
      'tg/-100',
      1,
      undefined,
    );
  });
});

// ---------------------------------------------------------------------------
// Full drain pipeline: _drainGroup drains requests
// Real fs + real DB; only container boundary mocked
// ---------------------------------------------------------------------------

describe('full drain pipeline (_drainGroup)', () => {
  it('processes request in drain pass', async () => {
    _setTestGroupRoute('root@g.us', ROOT);

    writeRequest('root', {
      id: 'req-drain',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'run',
      chatJid: 'tg/-100',
    });

    await _drainGroup(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-drain');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(true);
  });

  it('concurrent drain for same group is serialized (lock prevents double-process)', async () => {
    _setTestGroupRoute('root@g.us', ROOT);

    writeRequest('root', {
      id: 'req-lock',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'go',
      chatJid: 'tg/-100',
    });

    // Fire two concurrent drains; only one should see the file
    await Promise.all([
      _drainGroup(tmpDir, 'root', deps),
      _drainGroup(tmpDir, 'root', deps),
    ]);

    // delegateToChild called exactly once (lock prevented double process)
    expect(delegateToChild).toHaveBeenCalledTimes(1);
  });
});
