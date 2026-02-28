import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { executePipeline } from './tap.js';
import { RegisteredGroup, Route, TapContext, ToolCall } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  tapRoutes?: Route[];
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
}

let ipcWatcherRunning = false;

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                const targetGroup = registeredGroups[data.chatJid];
                if (isMain || (targetGroup && targetGroup.folder === sourceGroup)) {
                  // Run through tap pipeline if routes configured
                  if (deps.tapRoutes?.length) {
                    const call: ToolCall = { name: 'send_message', input: { chatJid: data.chatJid, text: data.text, sender: data.sender } };
                    const ctx: TapContext = { agentId: sourceGroup, channel: 'ipc', peerId: data.chatJid, groupFolder: sourceGroup };
                    const result = executePipeline(deps.tapRoutes, call, ctx);
                    if ('rejected' in result) {
                      logger.warn({ chatJid: data.chatJid, sourceGroup, reason: result.reason }, 'IPC message blocked by tap');
                      fs.unlinkSync(filePath);
                      continue;
                    }
                  }
                  await deps.sendMessage(data.chatJid, data.text);
                  logger.info({ chatJid: data.chatJid, sourceGroup }, 'IPC message sent');
                } else {
                  logger.warn({ chatJid: data.chatJid, sourceGroup }, 'Unauthorized IPC message blocked');
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, 'Error processing IPC message');
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC messages directory');
      }

      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error({ file, sourceGroup, err }, 'Error processing IPC task');
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string,
  isMain: boolean,
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (data.prompt && data.schedule_type && data.schedule_value && data.targetJid) {
        const targetJid = data.targetJid;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn({ targetJid }, 'Cannot schedule task: target group not registered');
          break;
        }

        const targetFolder = targetGroupEntry.folder;
        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn({ sourceGroup, targetFolder }, 'Unauthorized schedule_task blocked');
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';
        let nextRun: string | null = null;

        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, { tz: TIMEZONE });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn({ scheduleValue: data.schedule_value }, 'Invalid cron expression');
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) break;
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) break;
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode = data.context_mode === 'group' || data.context_mode === 'isolated'
          ? data.context_mode : 'isolated';
        createTask({
          id: taskId, group_folder: targetFolder, chat_jid: targetJid,
          prompt: data.prompt, schedule_type: scheduleType, schedule_value: data.schedule_value,
          context_mode: contextMode, next_run: nextRun, status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info({ taskId, sourceGroup, targetFolder }, 'Task created via IPC');
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task paused via IPC');
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task resumed via IPC');
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info({ taskId: data.taskId, sourceGroup }, 'Task cancelled via IPC');
        }
      }
      break;

    case 'refresh_groups':
      if (isMain) {
        await deps.syncGroupMetadata(true);
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup, true, availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      }
      break;

    case 'register_group':
      if (!isMain) break;
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn({ folder: data.folder }, 'Invalid register_group: unsafe folder name');
          break;
        }
        deps.registerGroup(data.jid, {
          name: data.name, folder: data.folder, trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
