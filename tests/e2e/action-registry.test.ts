/**
 * Action registry integration tests.
 *
 * Tests action registration, manifest generation, and the request-response
 * IPC flow (drainRequests) in-process. No docker required.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  _initTestDatabase,
  _setTestGroupRoute,
  GroupConfig,
} from '../../src/db.js';
// Import ipc.ts to trigger action registration side-effect
import '../../src/ipc.js';
import {
  getAction,
  getAllActions,
  getManifest,
} from '../../src/action-registry.js';
import type { IpcDeps } from '../../src/ipc-compat.js';

const EXPECTED_ACTIONS = [
  'send_message',
  'send_file',
  'schedule_task',
  'pause_task',
  'resume_task',
  'cancel_task',
  'refresh_groups',
  'register_group',
  'delegate_group',
  'escalate_group',
  'get_routes',
  'add_route',
  'delete_route',
  'reset_session',
];

const MAIN_GROUP: GroupConfig = {
  name: 'Root',
  folder: 'root',
  trigger: 'always',
  requiresTrigger: false,
  added_at: '2024-01-01T00:00:00.000Z',
};

let tmpDir: string;
let deps: IpcDeps;

beforeEach(() => {
  _initTestDatabase();
  _setTestGroupRoute('root@g.us', MAIN_GROUP);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanipi-action-test-'));

  deps = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendDocument: vi.fn().mockResolvedValue(undefined),
    getHubForJid: (jid: string) =>
      jid === 'root@g.us' ? MAIN_GROUP.folder : null,
    getJidsForFolder: (folder: string) =>
      folder === MAIN_GROUP.folder ? ['root@g.us'] : [],
    getRoutedJids: () => ['root@g.us'],
    getGroupConfig: (folder: string) =>
      folder === MAIN_GROUP.folder ? MAIN_GROUP : undefined,
    getDirectChildGroupCount: (_folder: string) => 0,
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn().mockResolvedValue(undefined),
    getAvailableGroups: () => [],
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn().mockResolvedValue(undefined),
    delegateToParent: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// -- Registration --

describe('action registration', () => {
  it('all expected actions are registered', () => {
    for (const name of EXPECTED_ACTIONS) {
      expect(getAction(name)).toBeDefined();
    }
  });

  it('getAction returns undefined for unknown action', () => {
    expect(getAction('nonexistent_action')).toBeUndefined();
  });

  it('getAllActions returns correct count', () => {
    const all = getAllActions();
    expect(all.length).toBeGreaterThanOrEqual(EXPECTED_ACTIONS.length);
    const names = all.map((a) => a.name);
    for (const name of EXPECTED_ACTIONS) {
      expect(names).toContain(name);
    }
  });
});

// -- Manifest --

describe('getManifest', () => {
  it('returns array with expected action names', () => {
    const manifest = getManifest();
    expect(Array.isArray(manifest)).toBe(true);
    const names = manifest.map((m) => m.name);
    for (const name of EXPECTED_ACTIONS) {
      expect(names).toContain(name);
    }
  });

  it('each manifest entry has name, description, and input schema', () => {
    const manifest = getManifest();
    for (const entry of manifest) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
      expect(entry.input).toBeDefined();
    }
  });
});

// -- Request/reply IPC flow --

describe('drainRequests flow', () => {
  // We test the file-based request/reply protocol by writing a request
  // JSON file and calling the internal drainRequests logic via
  // processTaskIpc (which exercises the same action dispatch).
  // For the full file-based flow we write request files and invoke
  // drainRequests indirectly through the exported startIpcWatcher
  // drain path — but since that requires fs.watch, we test the
  // request-reply contract at the action handler level instead.

  it('reset_session action returns result via handler', async () => {
    const action = getAction('reset_session')!;
    const result = await action.handler(
      {},
      {
        sourceGroup: 'root',
        isRoot: true,
        tier: 0 as const,
        sendMessage: deps.sendMessage,
        sendDocument: deps.sendDocument,
        getHubForJid: deps.getHubForJid,
        getRoutedJids: deps.getRoutedJids,
        getGroupConfig: deps.getGroupConfig,
        getDirectChildGroupCount: deps.getDirectChildGroupCount,
        registerGroup: deps.registerGroup,
        syncGroupMetadata: deps.syncGroupMetadata,
        getAvailableGroups: deps.getAvailableGroups,
        writeGroupsSnapshot: deps.writeGroupsSnapshot,
        clearSession: deps.clearSession,
        delegateToChild: deps.delegateToChild,
        delegateToParent: deps.delegateToParent,
      },
    );
    expect(result).toEqual({ reset: true });
    expect(deps.clearSession).toHaveBeenCalledWith('root');
  });

  it('send_message action dispatches to sendMessage dep', async () => {
    const action = getAction('send_message')!;
    const result = await action.handler(
      { chatJid: 'root@g.us', text: 'hello' },
      {
        sourceGroup: 'root',
        isRoot: true,
        tier: 0 as const,
        sendMessage: deps.sendMessage,
        sendDocument: deps.sendDocument,
        getHubForJid: deps.getHubForJid,
        getRoutedJids: deps.getRoutedJids,
        getGroupConfig: deps.getGroupConfig,
        getDirectChildGroupCount: deps.getDirectChildGroupCount,
        registerGroup: deps.registerGroup,
        syncGroupMetadata: deps.syncGroupMetadata,
        getAvailableGroups: deps.getAvailableGroups,
        writeGroupsSnapshot: deps.writeGroupsSnapshot,
        clearSession: deps.clearSession,
        delegateToChild: deps.delegateToChild,
        delegateToParent: deps.delegateToParent,
      },
    );
    expect(result).toEqual({ sent: true });
    expect(deps.sendMessage).toHaveBeenCalledWith(
      'root@g.us',
      'hello',
      undefined,
    );
  });

  it('unknown action name returns undefined from getAction', () => {
    expect(getAction('bogus_action')).toBeUndefined();
  });
});
