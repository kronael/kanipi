/**
 * Grants integration tests for IPC.
 *
 * Tests grants enforcement in the IPC drainRequests flow using real grants
 * logic (no mocks), real fs, and in-memory SQLite. Verifies that:
 * - Actions denied by grants return error replies
 * - Actions allowed by grants proceed to handlers
 * - list_actions respects grants (denied omitted, allowed have grants field)
 * - Grant overrides from DB merge with derived rules
 *
 * Not mocked: fs, grants.ts, action-registry.ts
 * Mocked: config (path overrides), logger, commands/index, db (in-memory)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  ASSISTANT_NAME: 'TestBot',
  DATA_DIR: '/tmp/kanipi-grants-ipc',
  GROUPS_DIR: '/tmp/kanipi-grants-ipc/groups',
  HOST_GROUPS_DIR: '/tmp/kanipi-grants-ipc/groups',
  IPC_POLL_INTERVAL: 60000,
  TIMEZONE: 'UTC',
  isRoot: (f: string) => f === 'root',
  permissionTier: (f: string) => {
    if (f === 'root') return 0;
    return Math.min(f.split('/').length, 3) as 1 | 2 | 3;
  },
}));

vi.mock('../../src/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/commands/index.js', () => ({
  writeCommandsXml: vi.fn(),
  registerCommand: vi.fn(),
  findCommand: vi.fn(),
}));

import {
  _initTestDatabase,
  _setTestGroupRoute,
  GroupConfig,
} from '../../src/db.js';
import '../../src/ipc.js';
import { drainRequests } from '../../src/ipc.js';
import type { IpcDeps } from '../../src/ipc.js';
import { setGrantOverrides, deleteGrantOverrides } from '../../src/grants.js';

let tmpDir: string;
let ipcDir: string;

const ROOT_JID = 'root@g.us';
const ROOT_GROUP: GroupConfig = {
  name: 'Root',
  folder: 'root',
  added_at: '2024-01-01T00:00:00.000Z',
};
const CHILD_GROUP: GroupConfig = {
  name: 'Child',
  folder: 'root/child',
  added_at: '2024-01-01T00:00:00.000Z',
};
const LEAF_GROUP: GroupConfig = {
  name: 'Leaf',
  folder: 'root/child/leaf',
  added_at: '2024-01-01T00:00:00.000Z',
};

function makeDeps(overrides: Partial<IpcDeps> = {}): IpcDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue('msg-001'),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    getHubForJid: (jid) => (jid === ROOT_JID ? 'root' : null),
    getJidsForFolder: (folder) => (folder === 'root' ? [ROOT_JID] : []),
    getRoutedJids: () => [ROOT_JID],
    getGroupConfig: (folder) => {
      if (folder === 'root') return ROOT_GROUP;
      if (folder === 'root/child') return CHILD_GROUP;
      if (folder === 'root/child/leaf') return LEAF_GROUP;
      return undefined;
    },
    getDirectChildGroupCount: () => 0,
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

function readReply(group: string, id: string): Record<string, unknown> {
  const p = path.join(ipcDir, group, 'replies', `${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

beforeEach(() => {
  _initTestDatabase();
  _setTestGroupRoute(ROOT_JID, ROOT_GROUP);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanipi-grants-ipc-'));
  ipcDir = path.join(tmpDir, 'ipc');
  fs.mkdirSync(ipcDir, { recursive: true });
});

afterEach(() => {
  // Clean up overrides
  try {
    deleteGrantOverrides('root');
  } catch {}
  try {
    deleteGrantOverrides('root/child');
  } catch {}
  try {
    deleteGrantOverrides('root/child/leaf');
  } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Grants enforcement in drainRequests ──────────────────────────────────────

describe('grants enforcement — tier 0 (root)', () => {
  it('root has wildcard grants, all actions allowed', async () => {
    const deps = makeDeps();
    const id = writeRequest('root', {
      type: 'reset_session',
    });
    await drainRequests(ipcDir, 'root', deps);

    const reply = readReply('root', id);
    expect(reply.ok).toBe(true);
  });

  it('root can send_message to any JID', async () => {
    const deps = makeDeps();
    const id = writeRequest('root', {
      type: 'send_message',
      chatJid: 'telegram:12345',
      text: 'hello',
    });
    await drainRequests(ipcDir, 'root', deps);

    const reply = readReply('root', id);
    expect(reply.ok).toBe(true);
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'telegram:12345',
      'hello',
      undefined,
    );
  });
});

describe('grants enforcement — tier 3 (leaf)', () => {
  it('leaf group can only send_reply by default', async () => {
    const deps = makeDeps();
    // send_reply requires chatJid in context, which comes from the request
    const id = writeRequest('root/child/leaf', {
      type: 'send_reply',
      text: 'hello',
      chatJid: ROOT_JID,
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(true);
  });

  it('leaf group denied send_message by default', async () => {
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', {
      type: 'send_message',
      chatJid: ROOT_JID,
      text: 'hello',
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('denied by grants');
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it('leaf group denied post by default', async () => {
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', {
      type: 'post',
      jid: 'twitter:123',
      content: 'tweet',
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('denied by grants');
  });

  it('leaf group denied schedule_task by default', async () => {
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', {
      type: 'schedule_task',
      targetFolder: 'root/child/leaf',
      prompt: 'do stuff',
      schedule_type: 'interval',
      schedule_value: '3600000',
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('denied by grants');
  });
});

describe('grants enforcement — grant overrides', () => {
  it('override adds send_message to leaf group', async () => {
    setGrantOverrides('root/child/leaf', ['send_message']);
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', {
      type: 'send_message',
      chatJid: ROOT_JID,
      text: 'overridden',
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(true);
    expect(deps.sendMessage).toHaveBeenCalled();
  });

  it('override deny on root restricts normally-allowed action', async () => {
    setGrantOverrides('root', ['!reset_session']);
    const deps = makeDeps();
    const id = writeRequest('root', {
      type: 'reset_session',
    });
    await drainRequests(ipcDir, 'root', deps);

    const reply = readReply('root', id);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('denied by grants');
  });

  it('deleted override restores default behavior', async () => {
    setGrantOverrides('root', ['!reset_session']);
    deleteGrantOverrides('root');
    const deps = makeDeps();
    const id = writeRequest('root', { type: 'reset_session' });
    await drainRequests(ipcDir, 'root', deps);

    const reply = readReply('root', id);
    expect(reply.ok).toBe(true);
  });
});

describe('grants enforcement — JID param matching', () => {
  it('send_message with matching jid param is allowed', async () => {
    // Tier 2 gets send_message scoped to platform
    // For root/child (tier 2), routes determine platforms.
    // Since ROOT_JID=root@g.us has no valid platform prefix,
    // we'll use overrides to test jid param matching directly.
    setGrantOverrides('root/child/leaf', ['send_message(jid=telegram:*)']);
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', {
      type: 'send_message',
      chatJid: 'telegram:12345',
      text: 'test',
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(true);
  });

  it('send_message with non-matching jid param is denied', async () => {
    setGrantOverrides('root/child/leaf', ['send_message(jid=telegram:*)']);
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', {
      type: 'send_message',
      chatJid: 'discord:99999',
      text: 'test',
    });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('denied by grants');
  });
});

// ── list_actions with grants ─────────────────────────────────────────────────

describe('list_actions respects grants', () => {
  it('root list_actions includes all actions with grants field', async () => {
    const deps = makeDeps();
    const id = writeRequest('root', { type: 'list_actions' });
    await drainRequests(ipcDir, 'root', deps);

    const reply = readReply('root', id);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{
      name: string;
      grants?: string[];
    }>;
    const names = actions.map((a) => a.name);
    expect(names).toContain('send_message');
    expect(names).toContain('send_reply');
    expect(names).toContain('reset_session');
    // All should have grants field since root derives ['*']
    const sm = actions.find((a) => a.name === 'send_message');
    expect(sm?.grants).toBeDefined();
    expect(sm!.grants).toContain('*');
  });

  it('leaf list_actions only includes send_reply', async () => {
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', { type: 'list_actions' });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{
      name: string;
      grants?: string[];
    }>;
    const names = actions.map((a) => a.name);
    expect(names).toContain('send_reply');
    // send_message should be excluded by grants
    expect(names).not.toContain('send_message');
    // post should be excluded by grants
    expect(names).not.toContain('post');
  });

  it('override adds action to leaf manifest', async () => {
    setGrantOverrides('root/child/leaf', ['schedule_task']);
    const deps = makeDeps();
    const id = writeRequest('root/child/leaf', { type: 'list_actions' });
    await drainRequests(ipcDir, 'root/child/leaf', deps);

    const reply = readReply('root/child/leaf', id);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{
      name: string;
      grants?: string[];
    }>;
    const names = actions.map((a) => a.name);
    expect(names).toContain('schedule_task');
    expect(names).toContain('send_reply');
  });

  it('override deny removes action from root manifest', async () => {
    setGrantOverrides('root', ['!reset_session']);
    const deps = makeDeps();
    const id = writeRequest('root', { type: 'list_actions' });
    await drainRequests(ipcDir, 'root', deps);

    const reply = readReply('root', id);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{ name: string }>;
    const names = actions.map((a) => a.name);
    expect(names).not.toContain('reset_session');
    // Other actions still present
    expect(names).toContain('send_message');
  });
});
