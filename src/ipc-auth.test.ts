import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  _initTestDatabase,
  _setTestGroupRoute,
  createTask,
  getAllTasks,
  getHubForJid,
  getGroupByFolder,
  getJidsForFolder,
  getRoutedJids,
  getTaskById,
  GroupConfig,
} from './db.js';
import { getAction } from './action-registry.js';
import { isRoot, permissionTier } from './config.js';
import { IpcDeps } from './ipc.js';
// Ensure actions are registered (ipc.ts side-effect)
import './ipc.js';

async function processTaskIpc(
  data: { type: string; [key: string]: unknown },
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  const action = getAction(data.type);
  if (!action) return;
  try {
    await action.handler(data, {
      sourceGroup,
      isRoot: isRoot(sourceGroup),
      tier: permissionTier(sourceGroup),
      ...deps,
    });
  } catch {}
}

// Set up registered groups used across tests
const ROOT_GROUP: GroupConfig = {
  name: 'Root',
  folder: 'root',
  added_at: '2024-01-01T00:00:00.000Z',
};

const OTHER_GROUP: GroupConfig = {
  name: 'Other',
  folder: 'discord/other-group',
  added_at: '2024-01-01T00:00:00.000Z',
};

const THIRD_GROUP: GroupConfig = {
  name: 'Third',
  folder: 'discord/third-group',
  added_at: '2024-01-01T00:00:00.000Z',
};

let deps: IpcDeps;

beforeEach(() => {
  _initTestDatabase();

  // Populate DB
  _setTestGroupRoute('root@g.us', ROOT_GROUP);
  _setTestGroupRoute('other@g.us', OTHER_GROUP);
  _setTestGroupRoute('third@g.us', THIRD_GROUP);

  deps = {
    sendMessage: async () => {},
    clearSession: vi.fn(),
    sendDocument: async () => {},
    getHubForJid,
    getJidsForFolder,
    getRoutedJids,
    getGroupConfig: getGroupByFolder,
    getDirectChildGroupCount: () => 0,
    registerGroup: (jid, group) => {
      _setTestGroupRoute(jid, group);
    },
    syncGroupMetadata: async () => {},
    getAvailableGroups: () => [],
    writeGroupsSnapshot: () => {},
    delegateToChild: async () => {},
    delegateToParent: async () => {},
  };
});

// --- schedule_task authorization ---

describe('schedule_task authorization', () => {
  it('root group can schedule for another group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'do something',
        schedule_type: 'once',
        schedule_value: '2027-06-01T00:00:00',
        targetFolder: 'discord/other-group',
      },
      'root',
      deps,
    );

    // Verify task was created in DB for the other group
    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('discord/other-group');
  });

  it('non-root group can schedule for itself', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'self task',
        schedule_type: 'once',
        schedule_value: '2027-06-01T00:00:00',
        targetFolder: 'discord/other-group',
      },
      'discord/other-group',
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('discord/other-group');
  });

  it('non-root group cannot schedule for another group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'unauthorized',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetFolder: 'root',
      },
      'discord/other-group',
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });

  it('root can schedule for any folder', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no target',
        schedule_type: 'once',
        schedule_value: '2027-06-01T00:00:00.000Z',
        targetFolder: 'nonexistent',
      },
      'root',
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(1);
    expect(allTasks[0].group_folder).toBe('nonexistent');
  });
});

// --- pause_task authorization ---

describe('pause_task authorization', () => {
  beforeEach(() => {
    createTask({
      id: 'task-main',
      group_folder: 'root',
      chat_jid: 'root@g.us',
      prompt: 'main task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
    createTask({
      id: 'task-other',
      group_folder: 'discord/other-group',
      chat_jid: 'other@g.us',
      prompt: 'other task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('root group can pause any task', async () => {
    await processTaskIpc(
      { type: 'pause_task', taskId: 'task-other' },
      'root',
      deps,
    );
    expect(getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-root group can pause its own task', async () => {
    await processTaskIpc(
      { type: 'pause_task', taskId: 'task-other' },
      'discord/other-group',
      deps,
    );
    expect(getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-root group cannot pause another groups task', async () => {
    await processTaskIpc(
      { type: 'pause_task', taskId: 'task-main' },
      'discord/other-group',
      deps,
    );
    expect(getTaskById('task-main')!.status).toBe('active');
  });
});

// --- resume_task authorization ---

describe('resume_task authorization', () => {
  beforeEach(() => {
    createTask({
      id: 'task-paused',
      group_folder: 'discord/other-group',
      chat_jid: 'other@g.us',
      prompt: 'paused task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2025-06-01T00:00:00.000Z',
      status: 'paused',
      created_at: '2024-01-01T00:00:00.000Z',
    });
  });

  it('root group can resume any task', async () => {
    await processTaskIpc(
      { type: 'resume_task', taskId: 'task-paused' },
      'root',
      deps,
    );
    expect(getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-root group can resume its own task', async () => {
    await processTaskIpc(
      { type: 'resume_task', taskId: 'task-paused' },
      'discord/other-group',
      deps,
    );
    expect(getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-root group cannot resume another groups task', async () => {
    await processTaskIpc(
      { type: 'resume_task', taskId: 'task-paused' },
      'discord/third-group',
      deps,
    );
    expect(getTaskById('task-paused')!.status).toBe('paused');
  });
});

// --- cancel_task authorization ---

describe('cancel_task authorization', () => {
  it('root group can cancel any task', async () => {
    createTask({
      id: 'task-to-cancel',
      group_folder: 'discord/other-group',
      chat_jid: 'other@g.us',
      prompt: 'cancel me',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc(
      { type: 'cancel_task', taskId: 'task-to-cancel' },
      'root',
      deps,
    );
    expect(getTaskById('task-to-cancel')).toBeUndefined();
  });

  it('non-root group can cancel its own task', async () => {
    createTask({
      id: 'task-own',
      group_folder: 'discord/other-group',
      chat_jid: 'other@g.us',
      prompt: 'my task',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc(
      { type: 'cancel_task', taskId: 'task-own' },
      'discord/other-group',
      deps,
    );
    expect(getTaskById('task-own')).toBeUndefined();
  });

  it('non-root group cannot cancel another groups task', async () => {
    createTask({
      id: 'task-foreign',
      group_folder: 'root',
      chat_jid: 'root@g.us',
      prompt: 'not yours',
      schedule_type: 'once',
      schedule_value: '2025-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    await processTaskIpc(
      { type: 'cancel_task', taskId: 'task-foreign' },
      'discord/other-group',
      deps,
    );
    expect(getTaskById('task-foreign')).toBeDefined();
  });
});

// --- register_group authorization ---

describe('register_group authorization', () => {
  it('non-root group cannot register a group', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: 'new-group',
      },
      'discord/other-group',
      deps,
    );

    // route should not have been registered
    expect(getHubForJid('new@g.us')).toBeNull();
  });

  it('root group cannot register with unsafe folder path', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: '../../outside',
      },
      'root',
      deps,
    );

    expect(getHubForJid('new@g.us')).toBeNull();
  });

  it('root group cannot register a folder deeper than 3 levels', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'deep@g.us',
        name: 'Deep Group',
        folder: 'atlas/support/web/deep',
      },
      'root',
      deps,
    );

    expect(getHubForJid('deep@g.us')).toBeNull();
  });
});

// --- register_group success path ---

describe('register_group success', () => {
  it('root group can register a child group inside a world', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: 'atlas/support',
      },
      'root',
      deps,
    );

    // Verify group was registered in DB
    const group = getGroupByFolder('atlas/support');
    expect(group).toBeDefined();
    expect(group!.name).toBe('New Group');
    expect(group!.folder).toBe('atlas/support');
  });

  it('register_group rejects request with missing fields', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'partial@g.us',
        name: 'Partial',
        // missing folder
      },
      'root',
      deps,
    );

    expect(getGroupByFolder('partial')).toBeUndefined();
  });
});

// --- reset_session IPC ---

describe('reset_session IPC', () => {
  it('calls clearSession with the sourceGroup', async () => {
    await processTaskIpc({ type: 'reset_session' }, 'root', deps);

    expect(deps.clearSession).toHaveBeenCalledWith('root');
  });
});
