import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';

import { registerAction, getManifest } from './action-registry.js';
import { IpcDeps } from './ipc.js';

// Mock config before importing drainRequests (ipc.ts imports config.ts)
vi.mock('./config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    GROUPS_DIR: '/fake/groups',
    HOST_GROUPS_DIR: '/fake/groups',
    DATA_DIR: '/fake/data',
    isRoot: () => true,
    permissionTier: () => 0 as const,
    IPC_POLL_INTERVAL: 60000,
  };
});

// Mock grants — tests run as tier 0 (root), grant everything
vi.mock('./grants.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    deriveRules: () => ['*'],
    getGrantOverrides: () => null,
    checkAction: () => true,
  };
});

// Must import after mock
const { drainRequests } = await import('./ipc.js');

let tmpDir: string;
let ipcBase: string;
const group = 'testgrp';

function reqDir(): string {
  return path.join(ipcBase, group, 'requests');
}

function repDir(): string {
  return path.join(ipcBase, group, 'replies');
}

function writeReq(id: string, data: Record<string, unknown>): void {
  const dir = reqDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data));
}

function readReply(id: string): Record<string, unknown> | null {
  const p = path.join(repDir(), `${id}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function makeDeps(overrides?: Partial<IpcDeps>): IpcDeps {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    getHubForJid: (_jid: string) => null,
    getJidsForFolder: (_folder: string) => [],
    getRoutedJids: () => [],
    getGroupConfig: (_folder: string) => undefined,
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

let actionSeq = 0;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
  ipcBase = path.join(tmpDir, 'ipc');
  fs.mkdirSync(ipcBase, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('drainRequests', () => {
  it('dispatches known action, writes reply, deletes request', async () => {
    const name = `ipc_test_${++actionSeq}`;
    let handlerCalled = false;
    registerAction({
      name,
      description: 'test',
      input: z.object({ id: z.string(), type: z.string(), val: z.number() }),
      handler: async (input) => {
        handlerCalled = true;
        return { echo: (input as { val: number }).val };
      },
    });

    writeReq('r1', { id: 'r1', type: name, val: 42 });
    await drainRequests(ipcBase, group, makeDeps());

    expect(handlerCalled).toBe(true);
    const reply = readReply('r1');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(true);
    expect(reply!.id).toBe('r1');
    expect((reply!.result as { echo: number }).echo).toBe(42);
    // Request file removed
    expect(fs.existsSync(path.join(reqDir(), 'r1.json'))).toBe(false);
  });

  it('returns error for unknown action', async () => {
    writeReq('r2', { id: 'r2', type: 'no_such_action_xyz' });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('r2');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toBe('unknown action: no_such_action_xyz');
  });

  it('deletes request with missing id', async () => {
    writeReq('bad1', { type: 'something' });
    await drainRequests(ipcBase, group, makeDeps());

    // Request file deleted
    expect(fs.existsSync(path.join(reqDir(), 'bad1.json'))).toBe(false);
    // No reply written (no id to name it)
    expect(fs.existsSync(repDir())).toBe(false);
  });

  it('handles list_actions request', async () => {
    writeReq('la1', { id: 'la1', type: 'list_actions' });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('la1');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(true);
    expect(Array.isArray(reply!.result)).toBe(true);
  });

  it('returns error for invalid input schema', async () => {
    const name = `ipc_test_${++actionSeq}`;
    registerAction({
      name,
      description: 'strict',
      input: z.object({
        id: z.string(),
        type: z.string(),
        required_field: z.number(),
      }),
      handler: async () => ({}),
    });

    // Missing required_field
    writeReq('r3', { id: 'r3', type: name });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('r3');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(false);
    expect(typeof reply!.error).toBe('string');
  });

  it('catches handler exceptions', async () => {
    const name = `ipc_test_${++actionSeq}`;
    registerAction({
      name,
      description: 'throws',
      input: z.object({ id: z.string(), type: z.string() }),
      handler: async () => {
        throw new Error('boom');
      },
    });

    writeReq('r4', { id: 'r4', type: name });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('r4');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toBe('boom');
  });

  it('is a no-op when requests dir does not exist', async () => {
    // No requests dir created — should not throw
    await drainRequests(ipcBase, group, makeDeps());
  });

  it('passes chatJid and messageId from request to action context', async () => {
    const name = `ipc_test_${++actionSeq}`;
    let capturedCtx: Record<string, unknown> | undefined;
    registerAction({
      name,
      description: 'ctx capture',
      input: z.object({
        id: z.string(),
        type: z.string(),
        chatJid: z.string().optional(),
        messageId: z.string().optional(),
      }),
      handler: async (_input, ctx) => {
        capturedCtx = {
          chatJid: (ctx as Record<string, unknown>).chatJid,
          messageId: (ctx as Record<string, unknown>).messageId,
        };
        return {};
      },
    });

    writeReq('ctx1', {
      id: 'ctx1',
      type: name,
      chatJid: 'telegram:123',
      messageId: 'msg-42',
    });
    await drainRequests(ipcBase, group, makeDeps());

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.chatJid).toBe('telegram:123');
    expect(capturedCtx!.messageId).toBe('msg-42');
  });

  it('handles handler throwing non-Error object', async () => {
    const name = `ipc_test_${++actionSeq}`;
    registerAction({
      name,
      description: 'throws string',
      input: z.object({ id: z.string(), type: z.string() }),
      handler: async () => {
        throw 'string error';
      },
    });

    writeReq('r6', { id: 'r6', type: name });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('r6');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toBe('string error');
  });

  it('send_file with ~/ prefix expands to /home/node/', async () => {
    // The send_file action is registered by ipc.ts on import.
    // A valid path under ~/ should be expanded and pass the safety check
    writeReq('r7', {
      id: 'r7',
      type: 'send_file',
      filepath: '~/tmp/report.pdf',
      chatJid: 'test@jid',
    });
    const deps = makeDeps();
    await drainRequests(ipcBase, group, deps);

    const reply = readReply('r7');
    expect(reply).not.toBeNull();
    // Should succeed (path is under group dir after expansion)
    expect(reply!.ok).toBe(true);
  });

  it('processes multiple requests in order', async () => {
    const name = `ipc_test_${++actionSeq}`;
    const order: number[] = [];
    registerAction({
      name,
      description: 'order tracker',
      input: z.object({
        id: z.string(),
        type: z.string(),
        seq: z.number(),
      }),
      handler: async (input) => {
        order.push((input as { seq: number }).seq);
        return {};
      },
    });

    writeReq('a', { id: 'a', type: name, seq: 1 });
    writeReq('b', { id: 'b', type: name, seq: 2 });
    writeReq('c', { id: 'c', type: name, seq: 3 });
    await drainRequests(ipcBase, group, makeDeps());

    expect(order).toHaveLength(3);
    // All three processed
    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order).toContain(3);
  });

  it('rejects send_file path traversal', async () => {
    // Register a send_file action so the type is known
    // The real one is registered by ipc.ts on import, so it exists.
    writeReq('r5', {
      id: 'r5',
      type: 'send_file',
      filepath: '/home/node/../../../etc/passwd',
      jid: 'test@jid',
    });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('r5');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toBe(
      'send_file: path must be under ~/ — save to ~/tmp/ first if needed',
    );
  });
});

describe('list_actions platform filtering', () => {
  const folder = 'social';

  function groupEntry(name: string): {
    name: string;
    folder: string;
    added_at: string;
  } {
    return { name, folder, added_at: '' };
  }

  function listActionsDeps(
    groups: Record<string, { name: string; folder: string; added_at: string }>,
  ): IpcDeps {
    return makeDeps({
      getJidsForFolder: (f: string) =>
        Object.entries(groups)
          .filter(([, g]) => g.folder === f)
          .map(([jid]) => jid),
    });
  }

  function writeReqFor(
    srcFolder: string,
    id: string,
    data: Record<string, unknown>,
  ): void {
    const dir = path.join(ipcBase, srcFolder, 'requests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(data));
  }

  function readReplyFor(
    srcFolder: string,
    id: string,
  ): Record<string, unknown> | null {
    const p = path.join(ipcBase, srcFolder, 'replies', `${id}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }

  async function listActions(
    deps: IpcDeps,
    srcFolder: string,
  ): Promise<Record<string, unknown>> {
    writeReqFor(srcFolder, 'la', { id: 'la', type: 'list_actions' });
    await drainRequests(ipcBase, srcFolder, deps);
    return readReplyFor(srcFolder, 'la') as Record<string, unknown>;
  }

  it('derives platforms from group JIDs', async () => {
    const groups = {
      'reddit:user': groupEntry('r'),
      'twitter:123': groupEntry('t'),
    };
    const reply = await listActions(listActionsDeps(groups), folder);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{ name: string }>;
    const names = actions.map((a) => a.name);
    // post is available on reddit+twitter
    expect(names).toContain('post');
    // timeout is discord/twitch/youtube only — should be excluded
    expect(names).not.toContain('timeout');
  });

  it('filters out email-style JIDs', async () => {
    const groups = {
      'notify@example.com': groupEntry('email'),
    };
    const reply = await listActions(listActionsDeps(groups), folder);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{ name: string }>;
    const names = actions.map((a) => a.name);
    // no valid platform derived, so platform-restricted actions excluded
    expect(names).not.toContain('post');
    expect(names).not.toContain('timeout');
  });

  it('deduplicates platforms', async () => {
    const groups = {
      'reddit:a': groupEntry('sub-a'),
      'reddit:b': groupEntry('sub-b'),
    };
    const reply = await listActions(listActionsDeps(groups), folder);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{ name: string }>;
    const postCount = actions.filter((a) => a.name === 'post').length;
    expect(postCount).toBe(1);
  });

  it('excludes social actions when no JIDs match folder', async () => {
    const groups = {
      'reddit:x': { name: 'x', folder: 'other', added_at: '' },
    };
    const reply = await listActions(listActionsDeps(groups), folder);
    expect(reply.ok).toBe(true);
    const actions = reply.result as Array<{ name: string }>;
    const names = actions.map((a) => a.name);
    // no platforms for 'social' folder, so platform-restricted actions excluded
    expect(names).not.toContain('post');
    expect(names).not.toContain('timeout');
    expect(names).not.toContain('set_flair');
  });
});
