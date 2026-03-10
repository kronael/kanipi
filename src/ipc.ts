import fs from 'fs';
import path from 'path';

import {
  Action,
  ActionContext,
  getAction,
  getManifest,
  registerAction,
} from './action-registry.js';
import { injectMessage } from './actions/inject.js';
import { sendFile, sendMessage } from './actions/messaging.js';
import { resetSession } from './actions/session.js';
import {
  cancelTask,
  pauseTask,
  resumeTask,
  scheduleTask,
} from './actions/tasks.js';
import {
  addRouteAction,
  delegateGroup,
  deleteRouteAction,
  escalateGroup,
  getRoutes,
  getRoutingRules,
  refreshGroups,
  registerGroup,
  setRoutes,
  setRoutingRules,
} from './actions/groups.js';
import { allSocialActions } from './actions/social.js';
import {
  DATA_DIR,
  GROUPS_DIR,
  HOST_GROUPS_DIR,
  IPC_POLL_INTERVAL,
  isRoot,
  permissionTier,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendDocument: (
    jid: string,
    filePath: string,
    filename?: string,
  ) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  clearSession: (groupFolder: string) => void;
  delegateToChild: (
    childFolder: string,
    prompt: string,
    originJid: string,
    depth: number,
  ) => Promise<void>;
  delegateToParent: (
    parentFolder: string,
    prompt: string,
    originJid: string,
    depth: number,
  ) => Promise<void>;
}

const allActions: Action[] = [
  sendMessage,
  sendFile,
  injectMessage,
  scheduleTask,
  pauseTask,
  resumeTask,
  cancelTask,
  refreshGroups,
  registerGroup,
  getRoutingRules,
  setRoutingRules,
  getRoutes,
  setRoutes,
  addRouteAction,
  deleteRouteAction,
  delegateGroup,
  escalateGroup,
  resetSession,
  ...allSocialActions,
];
for (const a of allActions) registerAction(a);

let ipcWatcherRunning = false;

const groupWatchers = new Map<
  string,
  {
    messages: fs.FSWatcher | null;
    tasks: fs.FSWatcher | null;
    requests: fs.FSWatcher | null;
  }
>();

const drainLocks = new Map<string, boolean>();

function buildContext(sourceGroup: string, deps: IpcDeps): ActionContext {
  return {
    sourceGroup,
    isRoot: isRoot(sourceGroup),
    tier: permissionTier(sourceGroup),
    ...deps,
  };
}

export async function _drainGroup(
  ipcBaseDir: string,
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  return drainGroupMessages(ipcBaseDir, sourceGroup, deps);
}

export async function drainRequests(
  ipcBaseDir: string,
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  const requestsDir = path.join(ipcBaseDir, sourceGroup, 'requests');
  const repliesDir = path.join(ipcBaseDir, sourceGroup, 'replies');
  if (!fs.existsSync(requestsDir)) return;

  const files = fs.readdirSync(requestsDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(requestsDir, file);
    try {
      const t0 = Date.now();
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const id = typeof data.id === 'string' ? data.id : String(data.id ?? '');
      const type = typeof data.type === 'string' ? data.type : '';
      if (!id || !type) {
        logger.warn({ file, sourceGroup }, 'IPC request missing id or type');
        try {
          fs.unlinkSync(filePath);
        } catch (e: unknown) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        continue;
      }

      let reply: { id: string; ok: boolean; result?: unknown; error?: string };

      if (type === 'list_actions') {
        const tier = permissionTier(sourceGroup);
        const groups = deps.registeredGroups();
        const platforms = [
          ...new Set(
            Object.entries(groups)
              .filter(([, g]) => g.folder === sourceGroup)
              .map(([jid]) => jid.split(':')[0])
              .filter((p) => p.length > 0 && !p.includes('@')),
          ),
        ];
        reply = {
          id,
          ok: true,
          result: getManifest(sourceGroup, { tier, platforms }),
        };
      } else {
        const action = getAction(type);
        if (!action) {
          reply = { id, ok: false, error: `unknown action: ${type}` };
        } else {
          try {
            // For send_file, translate container path to host path
            if (type === 'send_file' && data.filepath) {
              const rel = (data.filepath as string).replace(
                /^\/workspace\/group\/?/,
                '',
              );
              data.filepath = path.join(GROUPS_DIR, sourceGroup, rel);
              const hostPath = path.join(HOST_GROUPS_DIR, sourceGroup, rel);
              if (
                !hostPath.startsWith(
                  path.join(HOST_GROUPS_DIR, sourceGroup) + '/',
                )
              ) {
                reply = { id, ok: false, error: 'path outside group dir' };
                writeReply(repliesDir, reply);
                try {
                  fs.unlinkSync(filePath);
                } catch (e: unknown) {
                  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
                }
                continue;
              }
            }

            const parsed = action.input.safeParse(data);
            if (!parsed.success) {
              reply = { id, ok: false, error: parsed.error.message };
            } else {
              const ctx = buildContext(sourceGroup, deps);
              const result = await action.handler(parsed.data, ctx);
              reply = { id, ok: true, result };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            reply = { id, ok: false, error: msg };
          }
        }
      }

      writeReply(repliesDir, reply);
      logger.debug(
        { sourceGroup, type, id, dur: Date.now() - t0 },
        'IPC request handled',
      );
      try {
        fs.unlinkSync(filePath);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    } catch (err) {
      logger.error({ file, sourceGroup, err }, 'error processing IPC request');
      try {
        fs.unlinkSync(filePath);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
}

function writeReply(
  repliesDir: string,
  reply: { id: string; ok: boolean; result?: unknown; error?: string },
): void {
  fs.mkdirSync(repliesDir, { recursive: true });
  const tmp = path.join(repliesDir, `${reply.id}.json.tmp`);
  const final = path.join(repliesDir, `${reply.id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(reply));
  fs.renameSync(tmp, final);
}

async function drainGroupMessages(
  ipcBaseDir: string,
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  if (drainLocks.get(sourceGroup)) return;
  drainLocks.set(sourceGroup, true);
  try {
    await drainLegacyMessages(ipcBaseDir, sourceGroup, deps);
    await drainLegacyTasks(ipcBaseDir, sourceGroup, deps);
    await drainRequests(ipcBaseDir, sourceGroup, deps);
  } finally {
    drainLocks.delete(sourceGroup);
  }
}

async function drainLegacyMessages(
  ipcBaseDir: string,
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  const root = isRoot(sourceGroup);
  const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
  if (!fs.existsSync(messagesDir)) return;

  const registeredGroups = deps.registeredGroups();
  const files = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = path.join(messagesDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const targetGroup = registeredGroups[data.chatJid];
      const authorized =
        data.chatJid &&
        (root || (targetGroup && targetGroup.folder === sourceGroup));

      if (!authorized) {
        logger.warn(
          { chatJid: data.chatJid, sourceGroup },
          `unauthorized IPC ${data.type} blocked`,
        );
      } else if (data.type === 'message' && data.text) {
        await deps.sendMessage(data.chatJid, data.text);
        logger.info({ chatJid: data.chatJid, sourceGroup }, 'IPC message sent');
      } else if (data.type === 'file' && data.filepath) {
        const rel = (data.filepath as string).replace(
          /^\/workspace\/group\/?/,
          '',
        );
        const localPath = path.join(GROUPS_DIR, sourceGroup, rel);
        const hostPath = path.join(HOST_GROUPS_DIR, sourceGroup, rel);
        if (
          !hostPath.startsWith(path.join(HOST_GROUPS_DIR, sourceGroup) + '/')
        ) {
          logger.warn(
            { filepath: data.filepath, sourceGroup },
            'IPC file path outside GROUPS_DIR, blocked',
          );
        } else {
          await deps.sendDocument(
            data.chatJid,
            localPath,
            data.filename as string | undefined,
          );
          logger.info(
            { chatJid: data.chatJid, hostPath, sourceGroup },
            'IPC file sent',
          );
        }
      }
      try {
        fs.unlinkSync(filePath);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    } catch (err) {
      logger.error({ file, sourceGroup, err }, 'Error processing IPC message');
      try {
        fs.unlinkSync(filePath);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
}

async function drainLegacyTasks(
  ipcBaseDir: string,
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');
  if (!fs.existsSync(tasksDir)) return;

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const action = getAction(data.type);
      if (action) {
        const parsed = action.input.safeParse(data);
        if (!parsed.success) {
          logger.warn(
            { type: data.type, error: parsed.error.message, sourceGroup },
            'invalid legacy task input',
          );
        } else {
          try {
            await action.handler(parsed.data, buildContext(sourceGroup, deps));
          } catch (err) {
            logger.warn(
              { type: data.type, err, sourceGroup },
              'legacy task action failed',
            );
          }
        }
      } else {
        logger.warn(
          { type: data.type, sourceGroup, file },
          'Unknown IPC task type',
        );
      }
      fs.unlinkSync(filePath);
    } catch (err) {
      logger.error({ file, sourceGroup, err }, 'Error processing IPC task');
      try {
        fs.unlinkSync(filePath);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
}

function watchGroupDir(
  ipcBaseDir: string,
  sourceGroup: string,
  subdir: string,
  deps: IpcDeps,
): fs.FSWatcher | null {
  const dir = path.join(ipcBaseDir, sourceGroup, subdir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return fs.watch(dir, () => {
      drainGroupMessages(ipcBaseDir, sourceGroup, deps).catch((err) =>
        logger.error({ sourceGroup, err }, 'Error in inotify-triggered drain'),
      );
    });
  } catch (err) {
    logger.warn(
      { dir, err },
      'fs.watch failed for IPC dir, falling back to poll',
    );
    return null;
  }
}

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const scanGroupFolders = (): string[] =>
    fs.readdirSync(ipcBaseDir).filter((f) => {
      try {
        return (
          fs.statSync(path.join(ipcBaseDir, f)).isDirectory() && f !== 'errors'
        );
      } catch {
        return false;
      }
    });

  const attachWatchers = (sourceGroup: string) => {
    if (groupWatchers.has(sourceGroup)) return;
    groupWatchers.set(sourceGroup, {
      messages: watchGroupDir(ipcBaseDir, sourceGroup, 'messages', deps),
      tasks: watchGroupDir(ipcBaseDir, sourceGroup, 'tasks', deps),
      requests: watchGroupDir(ipcBaseDir, sourceGroup, 'requests', deps),
    });
  };

  // Startup drain sweep
  const startupDrain = async () => {
    let groupFolders: string[];
    try {
      groupFolders = scanGroupFolders();
    } catch (err) {
      logger.error(
        { err, ipcBaseDir },
        'Error reading IPC base directory on startup',
      );
      return;
    }

    for (const sourceGroup of groupFolders) {
      await drainGroupMessages(ipcBaseDir, sourceGroup, deps);
      attachWatchers(sourceGroup);
    }
  };

  startupDrain().catch((err) =>
    logger.error({ err, ipcBaseDir }, 'IPC startup drain error'),
  );

  // Poll for new group folders
  const pollForNewGroups = () => {
    let groupFolders: string[];
    try {
      groupFolders = scanGroupFolders();
    } catch {
      return;
    }

    for (const sourceGroup of groupFolders) {
      if (!groupWatchers.has(sourceGroup)) {
        drainGroupMessages(ipcBaseDir, sourceGroup, deps).catch((err) =>
          logger.error(
            { sourceGroup, err },
            'Error draining new group IPC dir',
          ),
        );
        attachWatchers(sourceGroup);
        logger.info({ sourceGroup }, 'IPC watcher attached to new group dir');
      }
    }
    setTimeout(pollForNewGroups, IPC_POLL_INTERVAL);
  };

  setTimeout(pollForNewGroups, IPC_POLL_INTERVAL);
  logger.info('IPC watcher started (inotify + fallback poll for new groups)');
}
