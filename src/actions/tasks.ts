import { z } from 'zod';

import { CronExpressionParser } from 'cron-parser';

import { Action } from '../action-registry.js';
import { TIMEZONE } from '../config.js';
import { createTask, deleteTask, getTaskById, updateTask } from '../db.js';
import { logger } from '../logger.js';
import { isInWorld } from '../permissions.js';

const ScheduleTaskInput = z.object({
  targetJid: z
    .string()
    .describe(
      'The JID (Jabber ID) to route task execution to. Format: phone@channel or groupid@channel.',
    ),
  prompt: z
    .string()
    .describe(
      'Agent prompt - spawns a full Claude Code agent with reasoning, tool use, and context. Use for tasks requiring analysis, decision-making, or multi-step operations. Mutually exclusive with command.',
    ),
  command: z
    .string()
    .optional()
    .describe(
      'Bash command to run directly without agent ceremony. Use for simple maintenance scripts (git pull, file cleanup, backups). Mutually exclusive with prompt. When provided, context_mode is forced to isolated.',
    ),
  schedule_type: z
    .enum(['cron', 'interval', 'once'])
    .describe(
      'How to schedule: "cron" for cron expressions, "interval" for recurring milliseconds, "once" for a single future execution.',
    ),
  schedule_value: z
    .string()
    .describe(
      'Schedule specification: cron expression (e.g., "0 2 * * *" for 2am daily), milliseconds as string (e.g., "3600000" for hourly), or ISO timestamp (e.g., "2026-03-11T15:30:00Z") for once.',
    ),
  context_mode: z
    .enum(['group', 'isolated'])
    .optional()
    .describe(
      'Execution context: "group" shares conversation history with the target group (agent sees past messages), "isolated" provides fresh context per run (no history). Defaults to isolated. Only applies to prompt mode; command mode is always isolated.',
    ),
});

export const scheduleTask: Action = {
  name: 'schedule_task',
  description: 'Schedule a recurring or one-time task',
  input: ScheduleTaskInput,
  async handler(raw, ctx) {
    const input = ScheduleTaskInput.parse(raw);
    if (input.prompt && input.command) {
      throw new Error('prompt and command are mutually exclusive');
    }
    const targetFolder = ctx.getDefaultTarget(input.targetJid);
    if (!targetFolder) {
      throw new Error('target JID has no route');
    }
    if (ctx.tier >= 3) throw new Error('unauthorized');
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
    const contextMode = input.command
      ? 'isolated'
      : input.context_mode === 'group'
        ? 'group'
        : 'isolated';
    createTask({
      id: taskId,
      group_folder: targetFolder,
      chat_jid: input.targetJid,
      prompt: input.prompt,
      command: input.command ?? null,
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
      if (ctx.tier >= 3) throw new Error('unauthorized');
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
