import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ActionContext } from '../action-registry.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../config.js', () => ({
  TIMEZONE: 'UTC',
  DATA_DIR: '/fake/data',
  STORE_DIR: '/fake/store',
  GROUPS_DIR: '/fake/groups',
  isRoot: (f: string) => f === 'root',
  permissionTier: (f: string) =>
    f === 'root' ? 0 : (Math.min(f.split('/').length, 3) as 0 | 1 | 2 | 3),
}));

vi.mock('../group-folder.js', () => ({
  isValidGroupFolder: () => true,
}));

import { _initTestDatabase, getTaskById } from '../db.js';

import { scheduleTask, pauseTask, resumeTask, cancelTask } from './tasks.js';

function makeCtx(overrides?: Partial<ActionContext>): ActionContext {
  return {
    sourceGroup: 'root',
    isRoot: true,
    tier: 0,
    sendMessage: vi.fn(),
    sendDocument: vi.fn(),
    getHubForJid: (jid: string) => (jid === 'tg:1' ? 'root' : null),
    getRoutedJids: vi.fn(),
    getGroupConfig: vi.fn(),
    getDirectChildGroupCount: vi.fn(),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(),
    getAvailableGroups: vi.fn(),
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn(),
    delegateToParent: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  _initTestDatabase();
});

describe('schedule_task', () => {
  it('creates a cron task', async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'do something',
        schedule_type: 'cron',
        schedule_value: '0 2 * * *',
      },
      makeCtx(),
    )) as { taskId: string };
    expect(r.taskId).toBeTruthy();
    const task = getTaskById(r.taskId);
    expect(task).toBeTruthy();
    expect(task!.schedule_type).toBe('cron');
    expect(task!.status).toBe('active');
    expect(task!.next_run).toBeTruthy();
  });

  it('creates an interval task', async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'check',
        schedule_type: 'interval',
        schedule_value: '3600000',
      },
      makeCtx(),
    )) as { taskId: string };
    const task = getTaskById(r.taskId);
    expect(task!.schedule_type).toBe('interval');
  });

  it('creates a once task', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'once',
        schedule_type: 'once',
        schedule_value: future,
      },
      makeCtx(),
    )) as { taskId: string };
    const task = getTaskById(r.taskId);
    expect(task!.schedule_type).toBe('once');
  });

  it('rejects both prompt and command', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetFolder: 'root',
          prompt: 'a',
          command: 'b',
          schedule_type: 'cron',
          schedule_value: '0 * * * *',
        },
        makeCtx(),
      ),
    ).rejects.toThrow('mutually exclusive');
  });

  it('rejects tier 3 (unauthorized)', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetFolder: 'root',
          prompt: 'a',
          schedule_type: 'cron',
          schedule_value: '0 * * * *',
        },
        makeCtx({ tier: 3 }),
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('defaults context_mode to isolated', async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'a',
        schedule_type: 'interval',
        schedule_value: '60000',
      },
      makeCtx(),
    )) as { taskId: string };
    const task = getTaskById(r.taskId);
    expect(task!.context_mode).toBe('isolated');
  });

  it('allows group context_mode', async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'a',
        schedule_type: 'interval',
        schedule_value: '60000',
        context_mode: 'group',
      },
      makeCtx(),
    )) as { taskId: string };
    const task = getTaskById(r.taskId);
    expect(task!.context_mode).toBe('group');
  });

  it('tier 2 cannot schedule task for another group', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetFolder: 'other',
          prompt: 'a',
          schedule_type: 'cron',
          schedule_value: '0 * * * *',
        },
        makeCtx({ tier: 2, sourceGroup: 'myworld/mygroup', isRoot: false }),
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('tier 2 can schedule task for own group', async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'myworld/mygroup',
        prompt: 'self task',
        schedule_type: 'interval',
        schedule_value: '60000',
      },
      makeCtx({ tier: 2, sourceGroup: 'myworld/mygroup', isRoot: false }),
    )) as { taskId: string };
    expect(r.taskId).toBeTruthy();
  });

  it('tier 1 cannot schedule task for other world', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetFolder: 'other/group',
          prompt: 'a',
          schedule_type: 'cron',
          schedule_value: '0 * * * *',
        },
        makeCtx({ tier: 1, sourceGroup: 'atlas', isRoot: false }),
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('command forces context_mode to isolated even when group requested', async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: '',
        command: 'echo hi',
        schedule_type: 'interval',
        schedule_value: '60000',
        context_mode: 'group',
      },
      makeCtx(),
    )) as { taskId: string };
    expect(r.taskId).toBeTruthy();
    const task = getTaskById(r.taskId);
    expect(task!.context_mode).toBe('isolated');
  });

  it('rejects invalid once timestamp', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetFolder: 'root',
          prompt: 'a',
          schedule_type: 'once',
          schedule_value: 'not-a-date',
        },
        makeCtx(),
      ),
    ).rejects.toThrow('invalid timestamp');
  });

  it('rejects invalid interval', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetFolder: 'root',
          prompt: 'a',
          schedule_type: 'interval',
          schedule_value: 'notanumber',
        },
        makeCtx(),
      ),
    ).rejects.toThrow('invalid interval');
  });
});

describe('pause_task / resume_task / cancel_task', () => {
  let taskId: string;

  beforeEach(async () => {
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'test',
        schedule_type: 'interval',
        schedule_value: '60000',
      },
      makeCtx(),
    )) as { taskId: string };
    taskId = r.taskId;
  });

  it('pauses an active task', async () => {
    await pauseTask.handler({ taskId }, makeCtx());
    expect(getTaskById(taskId)!.status).toBe('paused');
  });

  it('resumes a paused task', async () => {
    await pauseTask.handler({ taskId }, makeCtx());
    await resumeTask.handler({ taskId }, makeCtx());
    expect(getTaskById(taskId)!.status).toBe('active');
  });

  it('cancels (deletes) a task', async () => {
    await cancelTask.handler({ taskId }, makeCtx());
    expect(getTaskById(taskId)).toBeUndefined();
  });

  it('rejects tier 3 for pause', async () => {
    await expect(
      pauseTask.handler({ taskId }, makeCtx({ tier: 3 })),
    ).rejects.toThrow('unauthorized');
  });

  it('rejects nonexistent task', async () => {
    await expect(
      pauseTask.handler({ taskId: 'nope' }, makeCtx()),
    ).rejects.toThrow('unauthorized');
  });

  it('tier 2 can pause own group task', async () => {
    // Create task as root targeting 'myworld/mygroup'
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'myworld/mygroup',
        prompt: 'test',
        schedule_type: 'interval',
        schedule_value: '60000',
      },
      makeCtx(),
    )) as { taskId: string };

    // Tier 2 from same group can pause it
    await pauseTask.handler(
      { taskId: r.taskId },
      makeCtx({ tier: 2, sourceGroup: 'myworld/mygroup', isRoot: false }),
    );
    expect(getTaskById(r.taskId)!.status).toBe('paused');
  });

  it('tier 2 cannot pause task belonging to other group', async () => {
    // Create task targeting root
    const r = (await scheduleTask.handler(
      {
        targetFolder: 'root',
        prompt: 'test',
        schedule_type: 'interval',
        schedule_value: '60000',
      },
      makeCtx(),
    )) as { taskId: string };

    await expect(
      pauseTask.handler(
        { taskId: r.taskId },
        makeCtx({ tier: 2, sourceGroup: 'myworld/mygroup', isRoot: false }),
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('tier 3 cannot resume task', async () => {
    await expect(
      resumeTask.handler({ taskId }, makeCtx({ tier: 3 })),
    ).rejects.toThrow('unauthorized');
  });

  it('tier 3 cannot cancel task', async () => {
    await expect(
      cancelTask.handler({ taskId }, makeCtx({ tier: 3 })),
    ).rejects.toThrow('unauthorized');
  });
});
