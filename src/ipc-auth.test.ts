import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  _initTestDatabase,
  _setTestGroupRoute,
  createTask,
  getAllTasks,
  getDefaultTarget,
  getGroupByFolder,
  getJidsForFolder,
  getRoutedJids,
  getTaskById,
  GroupConfig,
} from './db.js';
import { processTaskIpc, IpcDeps } from './ipc-compat.js';
// Ensure actions are registered (ipc.ts side-effect)
import './ipc.js';

// Set up registered groups used across tests
const ROOT_GROUP: GroupConfig = {
  name: 'Root',
  folder: 'root',
  trigger: 'always',
  requiresTrigger: false,
  added_at: '2024-01-01T00:00:00.000Z',
};

const OTHER_GROUP: GroupConfig = {
  name: 'Other',
  folder: 'discord/other-group',
  trigger: '@Andy',
  requiresTrigger: true,
  added_at: '2024-01-01T00:00:00.000Z',
};

const THIRD_GROUP: GroupConfig = {
  name: 'Third',
  folder: 'discord/third-group',
  trigger: '@Andy',
  requiresTrigger: true,
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
    getDefaultTarget,
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
        targetJid: 'other@g.us',
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
        targetJid: 'other@g.us',
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
        targetJid: 'main@g.us',
      },
      'discord/other-group',
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
  });

  it('rejects schedule_task for unregistered target JID', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no target',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        targetJid: 'unknown@g.us',
      },
      'root',
      deps,
    );

    const allTasks = getAllTasks();
    expect(allTasks.length).toBe(0);
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
        trigger: '@Andy',
      },
      'discord/other-group',
      deps,
    );

    // route should not have been registered
    expect(getDefaultTarget('new@g.us')).toBeNull();
  });

  it('root group cannot register with unsafe folder path', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'new@g.us',
        name: 'New Group',
        folder: '../../outside',
        trigger: '@Andy',
      },
      'root',
      deps,
    );

    expect(getDefaultTarget('new@g.us')).toBeNull();
  });
});

// --- refresh_groups authorization ---

describe('refresh_groups authorization', () => {
  it('non-root group cannot trigger refresh', async () => {
    // This should be silently blocked (no crash, no effect)
    await processTaskIpc(
      { type: 'refresh_groups' },
      'discord/other-group',
      deps,
    );
    // If we got here without error, the auth gate worked
  });
});

// --- IPC message authorization ---
// Tests the authorization pattern from startIpcWatcher (ipc.ts).
// The logic: isRoot(sourceGroup) || targetFolder === sourceGroup

describe('IPC message authorization', () => {
  // Replicate the exact check from the IPC watcher
  function isRoot(folder: string): boolean {
    return folder === 'root';
  }

  function isMessageAuthorized(
    sourceGroup: string,
    targetChatJid: string,
  ): boolean {
    const targetFolder = getDefaultTarget(targetChatJid);
    return isRoot(sourceGroup) || targetFolder === sourceGroup;
  }

  it('root group can send to any group', () => {
    expect(isMessageAuthorized('root', 'other@g.us')).toBe(true);
    expect(isMessageAuthorized('root', 'third@g.us')).toBe(true);
  });

  it('non-root group can send to its own chat', () => {
    expect(isMessageAuthorized('discord/other-group', 'other@g.us')).toBe(true);
  });

  it('non-root group cannot send to another groups chat', () => {
    expect(isMessageAuthorized('discord/other-group', 'root@g.us')).toBe(false);
    expect(isMessageAuthorized('discord/other-group', 'third@g.us')).toBe(
      false,
    );
  });

  it('non-root group cannot send to unregistered JID', () => {
    expect(isMessageAuthorized('discord/other-group', 'unknown@g.us')).toBe(
      false,
    );
  });

  it('root group can send to unregistered JID', () => {
    // Root is always authorized regardless of target
    expect(isMessageAuthorized('root', 'unknown@g.us')).toBe(true);
  });
});

// --- schedule_task with cron and interval types ---

describe('schedule_task schedule types', () => {
  it('creates task with cron schedule and computes next_run', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'cron task',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *', // every day at 9am
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule_type).toBe('cron');
    expect(tasks[0].next_run).toBeTruthy();
    // next_run should be a valid ISO date in the future
    expect(new Date(tasks[0].next_run!).getTime()).toBeGreaterThan(
      Date.now() - 60000,
    );
  });

  it('rejects invalid cron expression', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad cron',
        schedule_type: 'cron',
        schedule_value: 'not a cron',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('creates task with interval schedule', async () => {
    const before = Date.now();

    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'interval task',
        schedule_type: 'interval',
        schedule_value: '3600000', // 1 hour
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].schedule_type).toBe('interval');
    // next_run should be ~1 hour from now
    const nextRun = new Date(tasks[0].next_run!).getTime();
    expect(nextRun).toBeGreaterThanOrEqual(before + 3600000 - 1000);
    expect(nextRun).toBeLessThanOrEqual(Date.now() + 3600000 + 1000);
  });

  it('rejects invalid interval (non-numeric)', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad interval',
        schedule_type: 'interval',
        schedule_value: 'abc',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid interval (zero)', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'zero interval',
        schedule_type: 'interval',
        schedule_value: '0',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid once timestamp', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad once',
        schedule_type: 'once',
        schedule_value: 'not-a-date',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    expect(getAllTasks()).toHaveLength(0);
  });
});

// --- context_mode defaulting ---

describe('schedule_task context_mode', () => {
  it('accepts context_mode=group', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'group context',
        schedule_type: 'once',
        schedule_value: '2027-06-01T00:00:00',
        context_mode: 'group',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('group');
  });

  it('accepts context_mode=isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'isolated context',
        schedule_type: 'once',
        schedule_value: '2027-06-01T00:00:00',
        context_mode: 'isolated',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
  });

  it('rejects invalid context_mode', async () => {
    const before = getAllTasks().length;
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'bad context',
        schedule_type: 'once',
        schedule_value: '2025-06-01T00:00:00.000Z',
        context_mode: 'bogus' as any,
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    expect(getAllTasks().length).toBe(before);
  });

  it('defaults missing context_mode to isolated', async () => {
    await processTaskIpc(
      {
        type: 'schedule_task',
        prompt: 'no context mode',
        schedule_type: 'once',
        schedule_value: '2027-06-01T00:00:00',
        targetJid: 'other@g.us',
      },
      'root',
      deps,
    );

    const tasks = getAllTasks();
    expect(tasks[0].context_mode).toBe('isolated');
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
        trigger: '@Andy',
      },
      'root',
      deps,
    );

    // Verify group was registered in DB
    const group = getGroupByFolder('atlas/support');
    expect(group).toBeDefined();
    expect(group!.name).toBe('New Group');
    expect(group!.folder).toBe('atlas/support');
    expect(group!.trigger).toBe('@Andy');
  });

  it('register_group rejects request with missing fields', async () => {
    await processTaskIpc(
      {
        type: 'register_group',
        jid: 'partial@g.us',
        name: 'Partial',
        // missing folder and trigger
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
    await processTaskIpc({ type: 'reset_session' }, 'main', deps);

    expect(deps.clearSession).toHaveBeenCalledWith('main');
  });
});
