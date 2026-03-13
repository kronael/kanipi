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
    getDefaultTarget: (jid: string) => (jid === 'tg:1' ? 'root' : null),
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
        targetJid: 'tg:1',
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
        targetJid: 'tg:1',
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
        targetJid: 'tg:1',
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
          targetJid: 'tg:1',
          prompt: 'a',
          command: 'b',
          schedule_type: 'cron',
          schedule_value: '0 * * * *',
        },
        makeCtx(),
      ),
    ).rejects.toThrow('mutually exclusive');
  });

  it('rejects unknown target JID', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetJid: 'unknown:99',
          prompt: 'a',
          schedule_type: 'cron',
          schedule_value: '0 * * * *',
        },
        makeCtx(),
      ),
    ).rejects.toThrow('no route');
  });

  it('rejects tier 3 (unauthorized)', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetJid: 'tg:1',
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
        targetJid: 'tg:1',
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
        targetJid: 'tg:1',
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

  it('rejects invalid interval', async () => {
    await expect(
      scheduleTask.handler(
        {
          targetJid: 'tg:1',
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
        targetJid: 'tg:1',
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
});
