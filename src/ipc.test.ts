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
    registeredGroups: () => ({}),
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

  it('deletes request with missing type', async () => {
    writeReq('bad2', { id: 'bad2' });
    await drainRequests(ipcBase, group, makeDeps());

    expect(fs.existsSync(path.join(reqDir(), 'bad2.json'))).toBe(false);
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

  it('rejects send_file path traversal', async () => {
    // Register a send_file action so the type is known
    // The real one is registered by ipc.ts on import, so it exists.
    writeReq('r5', {
      id: 'r5',
      type: 'send_file',
      filepath: '/workspace/group/../../../etc/passwd',
      jid: 'test@jid',
    });
    await drainRequests(ipcBase, group, makeDeps());

    const reply = readReply('r5');
    expect(reply).not.toBeNull();
    expect(reply!.ok).toBe(false);
    expect(reply!.error).toBe('path outside group dir');
  });
});
