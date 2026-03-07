import { z } from 'zod';

import { CronExpressionParser } from 'cron-parser';

import { Action } from '../action-registry.js';
import { TIMEZONE } from '../config.js';
import { createTask, deleteTask, getTaskById, updateTask } from '../db.js';
import { logger } from '../logger.js';
import { isInWorld } from '../permissions.js';

const ScheduleTaskInput = z.object({
  targetJid: z.string(),
  prompt: z.string(),
  schedule_type: z.enum(['cron', 'interval', 'once']),
  schedule_value: z.string(),
  context_mode: z.enum(['group', 'isolated']).optional(),
});

export const scheduleTask: Action = {
  name: 'schedule_task',
  description: 'Schedule a recurring or one-time task',
  input: ScheduleTaskInput,
  async handler(raw, ctx) {
    const input = ScheduleTaskInput.parse(raw);
    const groups = ctx.registeredGroups();
    const targetGroup = groups[input.targetJid];
    if (!targetGroup) {
      throw new Error('target group not registered');
    }
    const targetFolder = targetGroup.folder;
    if (ctx.tier === 3) throw new Error('unauthorized');
    if (ctx.tier === 2 && targetFolder !== ctx.sourceGroup) {
      throw new Error('unauthorized');
    }
    if (ctx.tier === 1 && !isInWorld(ctx.sourceGroup, targetFolder)) {
      throw new Error('unauthorized');
    }

    let nextRun: string | null = null;
    if (input.schedule_type === 'cron') {
      const interval = CronExpressionParser.parse(input.schedule_value, {
        tz: TIMEZONE,
      });
      nextRun = interval.next().toISOString();
    } else if (input.schedule_type === 'interval') {
      const ms = parseInt(input.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) throw new Error('invalid interval');
      nextRun = new Date(Date.now() + ms).toISOString();
    } else if (input.schedule_type === 'once') {
      const d = new Date(input.schedule_value);
      if (isNaN(d.getTime())) throw new Error('invalid timestamp');
      nextRun = d.toISOString();
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contextMode = input.context_mode === 'group' ? 'group' : 'isolated';
    createTask({
      id: taskId,
      group_folder: targetFolder,
      chat_jid: input.targetJid,
      prompt: input.prompt,
      schedule_type: input.schedule_type,
      schedule_value: input.schedule_value,
      context_mode: contextMode,
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });
    logger.info(
      { taskId, sourceGroup: ctx.sourceGroup, targetFolder },
      'task created via action',
    );
    return { taskId };
  },
};

const TaskIdInput = z.object({ taskId: z.string() });

function taskAction(
  name: string,
  description: string,
  fn: (taskId: string, ctx: { isRoot: boolean; sourceGroup: string }) => void,
): Action {
  return {
    name,
    description,
    input: TaskIdInput,
    async handler(raw, ctx) {
      const { taskId } = TaskIdInput.parse(raw);
      if (ctx.tier === 3) throw new Error('unauthorized');
      const task = getTaskById(taskId);
      if (!task) throw new Error('unauthorized');
      if (ctx.tier === 2 && task.group_folder !== ctx.sourceGroup) {
        throw new Error('unauthorized');
      }
      if (ctx.tier === 1 && !isInWorld(ctx.sourceGroup, task.group_folder)) {
        throw new Error('unauthorized');
      }
      fn(taskId, ctx);
      logger.info(
        { taskId, sourceGroup: ctx.sourceGroup },
        `task ${name} via action`,
      );
      return { ok: true };
    },
  };
}

export const pauseTask = taskAction(
  'pause_task',
  'Pause a scheduled task',
  (id) => updateTask(id, { status: 'paused' }),
);

export const resumeTask = taskAction(
  'resume_task',
  'Resume a paused task',
  (id) => updateTask(id, { status: 'active' }),
);

export const cancelTask = taskAction(
  'cancel_task',
  'Cancel and delete a scheduled task',
  (id) => deleteTask(id),
);
