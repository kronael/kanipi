/**
 * Integration tests for delegate_group IPC flow.
 * Uses real IPC request/reply files on disk and DB-backed registeredGroups.
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
  getAllRegisteredGroups,
  setRegisteredGroup,
} from './db.js';
import type { RegisteredGroup } from './types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ROOT: RegisteredGroup = {
  name: 'Root',
  folder: 'root',
  trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
};

const CODE: RegisteredGroup = {
  name: 'Code',
  folder: 'root/code',
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
};

const LOGS: RegisteredGroup = {
  name: 'Logs',
  folder: 'root/logs',
  trigger: '@Andy',
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
    // registeredGroups reads live from the in-memory SQLite DB
    registeredGroups: getAllRegisteredGroups,
    registerGroup: (jid, group) => setRegisteredGroup(jid, group),
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
    setRegisteredGroup('root@g.us', ROOT);
    setRegisteredGroup('child@g.us', CODE);

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
    );
  });

  it('request file deleted after processing', async () => {
    setRegisteredGroup('root@g.us', ROOT);

    writeRequest('root', {
      id: 'req-del',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'go',
      chatJid: 'tg/-100',
    });

    const requestFile = path.join(tmpDir, 'root', 'requests', 'req-del.json');
    expect(fs.existsSync(requestFile)).toBe(true);

    await drainRequests(tmpDir, 'root', deps);

    expect(fs.existsSync(requestFile)).toBe(false);
  });

  it('root world sibling delegation: allowed (root world privilege)', async () => {
    setRegisteredGroup('root@g.us', ROOT);
    setRegisteredGroup('logs@g.us', LOGS);

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
    const ATLAS: RegisteredGroup = {
      name: 'Atlas',
      folder: 'atlas',
      trigger: 'always',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    const ATLAS_A: RegisteredGroup = {
      name: 'Atlas A',
      folder: 'atlas/a',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    setRegisteredGroup('atlas@g.us', ATLAS);
    setRegisteredGroup('atlas-a@g.us', ATLAS_A);

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
    setRegisteredGroup('root@g.us', ROOT);

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
    );
  });

  it('multiple requests processed in one drain', async () => {
    setRegisteredGroup('root@g.us', ROOT);

    for (let i = 0; i < 3; i++) {
      writeRequest('root', {
        id: `req-multi-${i}`,
        type: 'delegate_group',
        group: 'root/code',
        prompt: `task ${i}`,
        chatJid: 'tg/-100',
      });
    }

    await drainRequests(tmpDir, 'root', deps);

    for (let i = 0; i < 3; i++) {
      expect(readReply('root', `req-multi-${i}`)!.ok).toBe(true);
    }
    expect(delegateToChild).toHaveBeenCalledTimes(3);
  });

  it('no requests dir: drainRequests returns without error', async () => {
    // No requests dir created — should return gracefully
    await expect(drainRequests(tmpDir, 'root', deps)).resolves.not.toThrow();
    expect(delegateToChild).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list_actions IPC
// ---------------------------------------------------------------------------

describe('list_actions IPC', () => {
  it('returns manifest containing delegate_group, escalate_group, and set_routing_rules', async () => {
    writeRequest('root', {
      id: 'req-manifest',
      type: 'list_actions',
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-manifest');
    expect(reply!.ok).toBe(true);
    const manifest = reply!.result as Array<{ name: string }>;
    expect(Array.isArray(manifest)).toBe(true);
    const names = manifest.map((a) => a.name);
    expect(names).toContain('delegate_group');
    expect(names).toContain('escalate_group');
    expect(names).toContain('set_routing_rules');
  });
});

// ---------------------------------------------------------------------------
// Unknown action type
// ---------------------------------------------------------------------------

describe('unknown action type', () => {
  it('returns error reply for unregistered action', async () => {
    writeRequest('root', {
      id: 'req-unknown',
      type: 'bogus_action_xyz',
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-unknown');
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toMatch(/unknown action/i);
  });
});

// ---------------------------------------------------------------------------
// set_routing_rules: DB-backed routing
// ---------------------------------------------------------------------------

describe('set_routing_rules IPC — DB-backed', () => {
  it('writes routing rules to DB, readable via getAllRegisteredGroups', async () => {
    setRegisteredGroup('root@g.us', ROOT);

    writeRequest('root', {
      id: 'req-rules',
      type: 'set_routing_rules',
      folder: 'root',
      rules: [
        { type: 'command', trigger: '/code', target: 'root/code' },
        { type: 'default', target: 'root/general' },
      ],
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-rules');
    expect(reply!.ok).toBe(true);
    expect(reply!.result).toMatchObject({ updated: true, ruleCount: 2 });

    // Routing rules must be persisted to the real in-memory SQLite DB
    const groups = getAllRegisteredGroups();
    const rules = groups['root@g.us'].routingRules;
    expect(rules).toHaveLength(2);
    expect(rules![0]).toMatchObject({
      type: 'command',
      trigger: '/code',
      target: 'root/code',
    });
    expect(rules![1]).toMatchObject({
      type: 'default',
      target: 'root/general',
    });
  });

  it('returns error when target folder not in DB', async () => {
    writeRequest('root', {
      id: 'req-nogroup',
      type: 'set_routing_rules',
      folder: 'nonexistent',
      rules: [{ type: 'default', target: 'root/general' }],
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-nogroup');
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toMatch(/not found/i);
  });

  it('non-root group cannot call set_routing_rules', async () => {
    setRegisteredGroup('child@g.us', CODE);

    writeRequest('root/code', {
      id: 'req-unauth',
      type: 'set_routing_rules',
      folder: 'root/code',
      rules: [{ type: 'default', target: 'root/code/py' }],
    });

    await drainRequests(tmpDir, 'root/code', deps);

    const reply = readReply('root/code', 'req-unauth');
    expect(reply!.ok).toBe(false);
    // routing rules should remain unset
    expect(getAllRegisteredGroups()['child@g.us'].routingRules).toBeUndefined();
  });

  it('set_routing_rules uses live DB state to resolve JID by folder', async () => {
    // Register three groups; set rules for the middle one
    setRegisteredGroup('root@g.us', ROOT);
    setRegisteredGroup('child@g.us', CODE);
    setRegisteredGroup('logs@g.us', LOGS);

    writeRequest('root', {
      id: 'req-mid',
      type: 'set_routing_rules',
      folder: 'root/code',
      rules: [{ type: 'keyword', keyword: 'py', target: 'root/code/py' }],
    });

    await drainRequests(tmpDir, 'root', deps);

    const reply = readReply('root', 'req-mid');
    expect(reply!.ok).toBe(true);

    // Only CODE group should have routing rules; LOGS untouched
    const groups = getAllRegisteredGroups();
    expect(groups['child@g.us'].routingRules).toHaveLength(1);
    expect(groups['logs@g.us'].routingRules).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DB-backed registeredGroups: live reads
// ---------------------------------------------------------------------------

describe('DB-backed registeredGroups — live reads', () => {
  it('registeredGroups dep reflects DB state at call time', () => {
    setRegisteredGroup('root@g.us', ROOT);
    expect(deps.registeredGroups()['root@g.us']).toBeDefined();

    setRegisteredGroup('child@g.us', CODE);
    const after = deps.registeredGroups();
    expect(after['child@g.us']).toBeDefined();
    expect(Object.keys(after)).toHaveLength(2);
  });

  it('delegate from non-root parent uses correct child path check', async () => {
    // main/code delegates to main/code/py — direct child, should succeed
    setRegisteredGroup('root@g.us', ROOT);
    setRegisteredGroup('child@g.us', CODE);

    writeRequest('root/code', {
      id: 'req-nested',
      type: 'delegate_group',
      group: 'root/code/py',
      prompt: 'run tests',
      chatJid: 'tg/-100',
      depth: 1,
    });

    await drainRequests(tmpDir, 'root/code', deps);

    const reply = readReply('root/code', 'req-nested');
    expect(reply!.ok).toBe(true);
    expect(delegateToChild).toHaveBeenCalledWith(
      'root/code/py',
      'run tests',
      'tg/-100',
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// Full drain pipeline: legacy messages + requests in one _drainGroup pass
// Real fs + real DB; only container boundary mocked
// ---------------------------------------------------------------------------

describe('full drain pipeline (_drainGroup)', () => {
  it('processes legacy message and request in single drain pass', async () => {
    setRegisteredGroup('root@g.us', ROOT);

    // Write a legacy message IPC file
    const messagesDir = path.join(tmpDir, 'root', 'messages');
    fs.mkdirSync(messagesDir, { recursive: true });
    fs.writeFileSync(
      path.join(messagesDir, 'msg-1.json'),
      JSON.stringify({ type: 'message', chatJid: 'root@g.us', text: 'hello' }),
    );

    // Write a request IPC file
    writeRequest('root', {
      id: 'req-drain',
      type: 'delegate_group',
      group: 'root/code',
      prompt: 'run',
      chatJid: 'tg/-100',
    });

    await _drainGroup(tmpDir, 'root', deps);

    // Legacy message path: sendMessage called
    expect(deps.sendMessage).toHaveBeenCalledWith('root@g.us', 'hello');
    // Legacy message file deleted
    expect(fs.existsSync(path.join(messagesDir, 'msg-1.json'))).toBe(false);

    // Request path: reply written
    const reply = readReply('root', 'req-drain');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(true);
  });

  it('concurrent drain for same group is serialized (lock prevents double-process)', async () => {
    setRegisteredGroup('root@g.us', ROOT);

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
