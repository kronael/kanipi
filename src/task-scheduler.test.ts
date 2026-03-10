import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, default: { ...actual, mkdirSync: vi.fn() } };
});

import { runContainerAgent } from './container-runner.js';
import { _initTestDatabase, createTask, getTaskById } from './db.js';
import {
  _resetSchedulerLoopForTests,
  startSchedulerLoop,
} from './task-scheduler.js';

const mockRunContainerAgent = vi.mocked(runContainerAgent);

describe('task scheduler', () => {
  beforeEach(() => {
    _initTestDatabase();
    _resetSchedulerLoopForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    _resetSchedulerLoopForTests();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('pauses due tasks with invalid group folders to prevent retry churn', async () => {
    createTask({
      id: 'task-invalid-folder',
      group_folder: '../../outside',
      chat_jid: 'bad@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: () => undefined,
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    const task = getTaskById('task-invalid-folder');
    expect(task?.status).toBe('paused');
  });

  it('passes session ID to agent when context_mode is group', async () => {
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: 'done',
      error: null,
    } as any);

    createTask({
      id: 'task-group-session',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'summarise',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'group',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: (folder) =>
        folder === 'main'
          ? {
              name: 'Main',
              folder: 'main',
              trigger: '',
              added_at: '2026-02-22T00:00:00.000Z',
              requiresTrigger: false,
            }
          : undefined,
      getSessions: () => ({ main: 'ses-abc123' }),
      queue: { enqueueTask, closeStdin: vi.fn(), notifyIdle: vi.fn() } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(mockRunContainerAgent).toHaveBeenCalled();
    const callArgs = mockRunContainerAgent.mock.calls[0];
    expect(callArgs[1]).toMatchObject({ sessionId: 'ses-abc123' });
  });

  it('passes undefined sessionId for isolated context_mode', async () => {
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: 'ok',
      error: null,
    } as any);

    createTask({
      id: 'task-isolated',
      group_folder: 'main',
      chat_jid: 'iso@g.us',
      prompt: 'run isolated',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: (folder) =>
        folder === 'main'
          ? {
              name: 'Main',
              folder: 'main',
              trigger: '',
              added_at: '2026-02-22T00:00:00.000Z',
              requiresTrigger: false,
            }
          : undefined,
      getSessions: () => ({ main: 'ses-abc123' }),
      queue: { enqueueTask, closeStdin: vi.fn(), notifyIdle: vi.fn() } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(mockRunContainerAgent).toHaveBeenCalledOnce();
    expect(mockRunContainerAgent.mock.calls[0][1].sessionId).toBeUndefined();
  });

  it('logs error when group not found for task', async () => {
    createTask({
      id: 'task-no-group',
      group_folder: 'main',
      chat_jid: 'missing@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: () => undefined,
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(50);

    // Should not attempt to run container
    expect(mockRunContainerAgent).not.toHaveBeenCalled();
    // Task stays active (not paused — that's only for invalid folders)
    const task = getTaskById('task-no-group');
    expect(task?.status).toBe('active');
  });

  it('logs error when container throws', async () => {
    mockRunContainerAgent.mockRejectedValue(new Error('docker boom'));

    createTask({
      id: 'task-crash',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: (folder) =>
        folder === 'main'
          ? {
              name: 'Main',
              folder: 'main',
              trigger: '',
              added_at: '2026-02-22T00:00:00.000Z',
              requiresTrigger: false,
            }
          : undefined,
      getSessions: () => ({}),
      queue: { enqueueTask, closeStdin: vi.fn(), notifyIdle: vi.fn() } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(50);

    // Task run logged with error
    const task = getTaskById('task-crash');
    expect(task?.last_result).toContain('Error: docker boom');
  });

  it('skips task re-checked as paused', async () => {
    createTask({
      id: 'task-paused-mid',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    // Pause the task before the loop picks it up
    const { updateTask: realUpdateTask } = await import('./db.js');
    realUpdateTask('task-paused-mid', { status: 'paused' });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: () => undefined,
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(mockRunContainerAgent).not.toHaveBeenCalled();
  });

  it('prevents duplicate scheduler starts', async () => {
    const deps = {
      getGroupConfig: () => undefined,
      getSessions: () => ({}),
      queue: { enqueueTask: vi.fn() } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    };

    startSchedulerLoop(deps);
    startSchedulerLoop(deps); // second call is no-op

    const { logger } = vi.mocked(await import('./logger.js'));
    expect(logger.debug).toHaveBeenCalledWith(
      'Scheduler loop already running, skipping duplicate start',
    );
  });

  it('sends result message and schedules close for streamed output', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const closeStdin = vi.fn();

    mockRunContainerAgent.mockImplementation(
      async (
        _group: unknown,
        _opts: unknown,
        _onProc: unknown,
        onStream: Function,
      ) => {
        await onStream({ result: 'task output', status: 'success' });
        return { status: 'success', result: 'task output' };
      },
    );

    createTask({
      id: 'task-stream',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      getGroupConfig: (folder) =>
        folder === 'main'
          ? {
              name: 'Main',
              folder: 'main',
              trigger: '',
              added_at: '2026-02-22T00:00:00.000Z',
              requiresTrigger: false,
            }
          : undefined,
      getSessions: () => ({}),
      queue: { enqueueTask, closeStdin, notifyIdle: vi.fn() } as any,
      onProcess: () => {},
      sendMessage,
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(sendMessage).toHaveBeenCalledWith('group@g.us', 'task output');
  });
});
