/**
 * IPC filesystem integration tests.
 *
 * Real fs + in-memory SQLite + IPC file protocol, no docker, no channel deps.
 * This is the integration layer that action-registry.test.ts skips: actual
 * file I/O for the full request → drain → reply cycle, including DB-backed
 * action handlers (schedule_task) and a watcher-driven drain loop.
 *
 * Not mocked: fs, db (in-memory SQLite via _initTestDatabase)
 * Mocked: config (path overrides), logger (suppress output), commands/index
 *   (avoid fs.watch side-effects from writeCommandsXml writing to DATA_DIR)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock config ───────────────────────────────────────────────────────────────
// Provide stable paths so ipc.ts path-safety checks are deterministic.
// DATA_DIR and GROUPS_DIR are intentionally set to non-existent paths;
// drainRequests only uses them for send_file (not tested here).

vi.mock('../../src/config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DATA_DIR: '/tmp/kanipi-ipc-fs-config',
  GROUPS_DIR: '/tmp/kanipi-ipc-fs-config/groups',
  HOST_GROUPS_DIR: '/tmp/kanipi-ipc-fs-config/groups',
  IPC_POLL_INTERVAL: 60000,
  TIMEZONE: 'UTC',
  isRoot: (f: string) => !f.includes('/'),
  permissionTier: (f: string) =>
    f.includes('/') ? Math.min(f.split('/').length, 3) : 0,
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Prevent register_group / set_routing_rules from writing commands.xml
// into DATA_DIR (which is a fake path and would throw ENOENT).
vi.mock('../../src/commands/index.js', () => ({
  writeCommandsXml: vi.fn(),
  registerCommand: vi.fn(),
  findCommand: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  _initTestDatabase,
  getTasksForGroup,
  setRegisteredGroup,
} from '../../src/db.js';
// Side-effect import: registers all IPC actions into the action registry.
import '../../src/ipc.js';
import { drainRequests, _drainGroup } from '../../src/ipc.js';
import type { IpcDeps } from '../../src/ipc.js';
import type { RegisteredGroup } from '../../src/types.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const MAIN_JID = 'main@g.us';
const MAIN_GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: 'always',
  added_at: '2024-01-01T00:00:00.000Z',
};

let tmpDir: string;
let ipcDir: string;

function makeDeps(overrides: Partial<IpcDeps> = {}): IpcDeps & {
  sendMessage: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
  clearSession: ReturnType<typeof vi.fn>;
} {
  const base: IpcDeps = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    registeredGroups: () => ({ [MAIN_JID]: MAIN_GROUP }),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn().mockResolvedValue(undefined),
    getAvailableGroups: () => [],
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn().mockResolvedValue(undefined),
    delegateToParent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return base as IpcDeps & {
    sendMessage: ReturnType<typeof vi.fn>;
    sendDocument: ReturnType<typeof vi.fn>;
    clearSession: ReturnType<typeof vi.fn>;
  };
}

/** Write a request JSON file to ipcDir/group/requests/ and return its id. */
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

/** Read a reply JSON from ipcDir/group/replies/<id>.json. */
function readReply(group: string, id: string): Record<string, unknown> {
  const p = path.join(ipcDir, group, 'replies', `${id}.json`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/** List files in a dir, returning [] if the dir doesn't exist. */
function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

beforeEach(() => {
  _initTestDatabase();
  setRegisteredGroup(MAIN_JID, MAIN_GROUP);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanipi-ipc-fs-'));
  ipcDir = path.join(tmpDir, 'ipc');
  fs.mkdirSync(ipcDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── drainRequests: real file I/O ──────────────────────────────────────────────

describe('drainRequests — real fs request/reply protocol', () => {
  it('list_actions: writes reply file with action manifest', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', { type: 'list_actions' });

    await drainRequests(ipcDir, 'main', deps);

    const reply = readReply('main', id);
    expect(reply.ok).toBe(true);
    expect(Array.isArray(reply.result)).toBe(true);
    const names = (reply.result as { name: string }[]).map((a) => a.name);
    expect(names).toContain('send_message');
    expect(names).toContain('schedule_task');
  });

  it('send_message: dispatches to dep and writes ok reply', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', {
      type: 'send_message',
      chatJid: MAIN_JID,
      text: 'hello from IPC',
    });

    await drainRequests(ipcDir, 'main', deps);

    const reply = readReply('main', id);
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ sent: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(MAIN_JID, 'hello from IPC');
  });

  it('reset_session: calls clearSession dep and writes ok reply', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', { type: 'reset_session' });

    await drainRequests(ipcDir, 'main', deps);

    const reply = readReply('main', id);
    expect(reply.ok).toBe(true);
    expect(reply.result).toEqual({ reset: true });
    expect(deps.clearSession).toHaveBeenCalledWith('main');
  });

  it('schedule_task: persists task to DB and writes ok reply with taskId', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', {
      type: 'schedule_task',
      targetJid: MAIN_JID,
      prompt: 'run daily report',
      schedule_type: 'interval',
      schedule_value: '86400000',
    });

    await drainRequests(ipcDir, 'main', deps);

    const reply = readReply('main', id);
    expect(reply.ok).toBe(true);
    expect(typeof (reply.result as { taskId: string }).taskId).toBe('string');

    // Real DB side-effect: task row was created
    const tasks = getTasksForGroup('main');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].prompt).toBe('run daily report');
    expect(tasks[0].group_folder).toBe('main');
  });

  it('unknown action: writes error reply without crashing', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', { type: 'nonexistent_action_xyz' });

    await drainRequests(ipcDir, 'main', deps);

    const reply = readReply('main', id);
    expect(reply.ok).toBe(false);
    expect(typeof reply.error).toBe('string');
    expect(reply.error).toContain('nonexistent_action_xyz');
  });

  it('invalid action input: writes error reply with validation message', async () => {
    const deps = makeDeps();
    // send_message requires chatJid and text; omit both
    const id = writeRequest('main', { type: 'send_message' });

    await drainRequests(ipcDir, 'main', deps);

    const reply = readReply('main', id);
    expect(reply.ok).toBe(false);
    expect(typeof reply.error).toBe('string');
  });

  it('request file is deleted after processing', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', { type: 'reset_session' });
    const reqPath = path.join(ipcDir, 'main', 'requests', `${id}.json`);

    expect(fs.existsSync(reqPath)).toBe(true);
    await drainRequests(ipcDir, 'main', deps);
    expect(fs.existsSync(reqPath)).toBe(false);
  });

  it('malformed JSON: deletes bad file, does not write reply', async () => {
    const deps = makeDeps();
    const reqDir = path.join(ipcDir, 'main', 'requests');
    fs.mkdirSync(reqDir, { recursive: true });
    fs.writeFileSync(path.join(reqDir, 'bad.json'), '{ not valid json @@');

    await drainRequests(ipcDir, 'main', deps);

    // Requests dir should be empty — bad file deleted
    expect(listDir(reqDir)).toHaveLength(0);
  });

  it('processes multiple requests in one drain sweep', async () => {
    const deps = makeDeps();
    writeRequest('main', { type: 'reset_session' });
    writeRequest('main', { type: 'reset_session' });
    writeRequest('main', { type: 'reset_session' });

    await drainRequests(ipcDir, 'main', deps);

    expect(deps.clearSession).toHaveBeenCalledTimes(3);
  });
});

// ── drainRequests: reply file is atomic (tmp → final rename) ─────────────────

describe('drainRequests — reply atomicity', () => {
  it('reply file appears as final .json (not .tmp) after drain', async () => {
    const deps = makeDeps();
    const id = writeRequest('main', { type: 'reset_session' });

    await drainRequests(ipcDir, 'main', deps);

    const repliesDir = path.join(ipcDir, 'main', 'replies');
    const files = listDir(repliesDir);
    expect(files).toContain(`${id}.json`);
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });
});

// ── _drainGroup: full pipeline (legacy + requests) ────────────────────────────

describe('_drainGroup — full IPC pipeline with real fs', () => {
  it('drains legacy message file and calls sendMessage', async () => {
    const deps = makeDeps();

    // Write a legacy IPC message
    const msgDir = path.join(ipcDir, 'main', 'messages');
    fs.mkdirSync(msgDir, { recursive: true });
    fs.writeFileSync(
      path.join(msgDir, 'msg-001.json'),
      JSON.stringify({ type: 'message', chatJid: MAIN_JID, text: 'legacy hi' }),
    );

    await _drainGroup(ipcDir, 'main', deps);

    expect(deps.sendMessage).toHaveBeenCalledWith(MAIN_JID, 'legacy hi');
    // File consumed
    expect(listDir(msgDir)).toHaveLength(0);
  });

  it('drains legacy message and request in same sweep', async () => {
    const deps = makeDeps();

    const msgDir = path.join(ipcDir, 'main', 'messages');
    fs.mkdirSync(msgDir, { recursive: true });
    fs.writeFileSync(
      path.join(msgDir, 'msg-002.json'),
      JSON.stringify({ type: 'message', chatJid: MAIN_JID, text: 'sweep me' }),
    );

    const id = writeRequest('main', { type: 'reset_session' });

    await _drainGroup(ipcDir, 'main', deps);

    expect(deps.sendMessage).toHaveBeenCalledWith(MAIN_JID, 'sweep me');
    const reply = readReply('main', id);
    expect(reply.ok).toBe(true);
  });

  it('unauthorized legacy message is blocked (non-root group)', async () => {
    // Create a child group that only owns its own folder
    const childJid = 'child@g.us';
    const childGroup: RegisteredGroup = {
      name: 'Child',
      folder: 'main/child',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    const deps = makeDeps({
      registeredGroups: () => ({
        [MAIN_JID]: MAIN_GROUP,
        [childJid]: childGroup,
      }),
    });

    const msgDir = path.join(ipcDir, 'main/child', 'messages');
    fs.mkdirSync(msgDir, { recursive: true });
    // Child tries to send to main group JID — this is unauthorized
    // because the child's folder ('main/child') !== MAIN_GROUP.folder ('main')
    fs.writeFileSync(
      path.join(msgDir, 'msg-unauth.json'),
      JSON.stringify({ type: 'message', chatJid: MAIN_JID, text: 'sneaky' }),
    );

    await _drainGroup(ipcDir, 'main/child', deps);

    expect(deps.sendMessage).not.toHaveBeenCalled();
    // File still consumed (not left in queue to retry indefinitely)
    expect(listDir(msgDir)).toHaveLength(0);
  });
});

// ── Watcher-driven drain via real fs.watch ────────────────────────────────────
//
// Directly exercises the notification-based drain pattern: writing a file to
// a watched directory should trigger drainRequests without manual polling.

describe('watcher-driven drain — real fs.watch triggers', () => {
  it('fs.watch event fires when a request file is written', async () => {
    const reqDir = path.join(tmpDir, 'watch-group', 'requests');
    fs.mkdirSync(reqDir, { recursive: true });

    const fired = await new Promise<boolean>((resolve) => {
      const watcher = fs.watch(reqDir, () => {
        watcher.close();
        resolve(true);
      });
      // Write a file after the watcher is set up
      setTimeout(() => {
        fs.writeFileSync(path.join(reqDir, 'probe.json'), '{}');
      }, 10);
    });

    expect(fired).toBe(true);
  });

  it('drain triggered by watch event processes request and writes reply', async () => {
    const deps = makeDeps();
    const reqDir = path.join(ipcDir, 'main', 'requests');
    fs.mkdirSync(reqDir, { recursive: true });

    const drainCalled = new Promise<void>((resolve) => {
      const watcher = fs.watch(reqDir, () => {
        watcher.close();
        drainRequests(ipcDir, 'main', deps).then(resolve);
      });

      // Write request after watcher is active
      setTimeout(() => {
        const id = `watch-req-${Date.now()}`;
        fs.writeFileSync(
          path.join(reqDir, `${id}.json`),
          JSON.stringify({ id, type: 'reset_session' }),
        );
      }, 10);
    });

    await drainCalled;

    expect(deps.clearSession).toHaveBeenCalledWith('main');
    // Reply file written to disk by the watcher-triggered drain
    const repliesDir = path.join(ipcDir, 'main', 'replies');
    expect(listDir(repliesDir).filter((f) => f.endsWith('.json'))).toHaveLength(
      1,
    );
  }, 5000);
});
