import fs from 'fs';
import path from 'path';

function unlinkSafe(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

import {
  Action,
  ActionContext,
  getAction,
  getManifest,
  registerAction,
} from './action-registry.js';
import { SendOpts } from './types.js';
import { injectMessage } from './actions/inject.js';
import { sendFile, sendMessage, sendReply } from './actions/messaging.js';
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
  refreshGroups,
  registerGroup,
} from './actions/groups.js';
import { getGrants, setGrants } from './actions/grants-actions.js';
import { allSocialActions } from './actions/social.js';
import {
  DATA_DIR,
  GROUPS_DIR,
  HOST_GROUPS_DIR,
  IPC_POLL_INTERVAL,
  isRoot,
  permissionTier,
} from './config.js';
import { checkAction, deriveRules, getGrantOverrides } from './grants.js';
import { AvailableGroup } from './container-runner.js';
import { GroupConfig } from './db.js';
import { logger } from './logger.js';

export interface IpcDeps {
  sendMessage: (
    jid: string,
    text: string,
    opts?: SendOpts,
  ) => Promise<string | undefined>;
  sendDocument: (
    jid: string,
    filePath: string,
    filename?: string,
  ) => Promise<void>;
  getHubForJid: (jid: string) => string | null;
  getJidsForFolder: (folder: string) => string[];
  getRoutedJids: () => string[];
  getGroupConfig: (folder: string) => GroupConfig | undefined;
  getDirectChildGroupCount: (parentFolder: string) => number;
  registerGroup: (jid: string, group: GroupConfig) => void;
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
    messageId?: string,
  ) => Promise<void>;
  delegateToParent: (
    parentFolder: string,
    prompt: string,
    originJid: string,
    depth: number,
    messageId?: string,
    escalationOrigin?: { jid: string; messageId?: string },
  ) => Promise<void>;
}

const allActions: Action[] = [
  sendMessage,
  sendReply,
  sendFile,
  injectMessage,
  scheduleTask,
  pauseTask,
  resumeTask,
  cancelTask,
  refreshGroups,
  registerGroup,
  getRoutes,
  addRouteAction,
  deleteRouteAction,
  delegateGroup,
  escalateGroup,
  resetSession,
  getGrants,
  setGrants,
  ...allSocialActions,
];
for (const a of allActions) registerAction(a);

let ipcWatcherRunning = false;

const groupWatchers = new Map<string, { requests: fs.FSWatcher | null }>();

const drainLocks = new Map<string, boolean>();

function buildContext(
  sourceGroup: string,
  deps: IpcDeps,
  chatJid?: string,
  messageId?: string,
): ActionContext {
  return {
    sourceGroup,
    chatJid,
    messageId,
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
        unlinkSafe(filePath);
        continue;
      }

      let reply: { id: string; ok: boolean; result?: unknown; error?: string };

      if (type === 'list_actions') {
        const tier = permissionTier(sourceGroup);
        const platforms = [
          ...new Set(
            deps
              .getJidsForFolder(sourceGroup)
              .map((jid) => jid.split(':')[0])
              .filter((p) => p.length > 0 && !p.includes('@')),
          ),
        ];
        const listRules = deriveRules(sourceGroup);
        const listOverrides = getGrantOverrides(sourceGroup);
        const listGrants = listOverrides
          ? [...listRules, ...listOverrides]
          : listRules;
        reply = {
          id,
          ok: true,
          result: getManifest(sourceGroup, {
            tier,
            platforms,
            grants: listGrants,
          }),
        };
      } else {
        const action = getAction(type);
        if (!action) {
          reply = { id, ok: false, error: `unknown action: ${type}` };
        } else {
          // Grants check: derive rules + overrides, check action
          const rules = deriveRules(sourceGroup);
          const overrides = getGrantOverrides(sourceGroup);
          const allRules = overrides ? [...rules, ...overrides] : rules;
          const grantParams: Record<string, string> = {};
          const jidVal = data.jid ?? data.chatJid;
          if (typeof jidVal === 'string') grantParams.jid = jidVal;
          if (!checkAction(allRules, type, grantParams)) {
            reply = {
              id,
              ok: false,
              error: `denied by grants: ${type}`,
            };
            writeReply(repliesDir, reply);
            unlinkSafe(filePath);
            continue;
          }

          try {
            // For send_file, translate container path to host path
            if (type === 'send_file' && data.filepath) {
              const expanded = (data.filepath as string).replace(
                /^~\//,
                '/home/node/',
              );
              const rel = expanded.replace(/^\/home\/node\/?/, '');
              data.filepath = path.join(GROUPS_DIR, sourceGroup, rel);
              const hostPath = path.join(HOST_GROUPS_DIR, sourceGroup, rel);
              if (
                !hostPath.startsWith(
                  path.join(HOST_GROUPS_DIR, sourceGroup) + '/',
                )
              ) {
                reply = {
                  id,
                  ok: false,
                  error:
                    'send_file: path must be under ~/ — save to ~/tmp/ first if needed',
                };
                writeReply(repliesDir, reply);
                unlinkSafe(filePath);
                continue;
              }
            }

            const parsed = action.input.safeParse(data);
            if (!parsed.success) {
              reply = { id, ok: false, error: parsed.error.message };
            } else {
              const reqJid =
                typeof data.chatJid === 'string' ? data.chatJid : undefined;
              const reqMsgId =
                typeof data.messageId === 'string' ? data.messageId : undefined;
              const ctx = buildContext(sourceGroup, deps, reqJid, reqMsgId);
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
      unlinkSafe(filePath);
    } catch (err) {
      logger.error({ file, sourceGroup, err }, 'error processing IPC request');
      unlinkSafe(filePath);
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
    await drainRequests(ipcBaseDir, sourceGroup, deps);
  } finally {
    drainLocks.delete(sourceGroup);
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

  const scanGroupFolders = (): string[] => {
    const results: string[] = [];
    const walk = (dir: string, rel: string) => {
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const e of entries) {
        if (e === 'errors') continue;
        const full = path.join(dir, e);
        try {
          if (!fs.statSync(full).isDirectory()) continue;
        } catch {
          continue;
        }
        const r = rel ? `${rel}/${e}` : e;
        if (fs.existsSync(path.join(full, 'requests'))) {
          results.push(r);
        }
        walk(full, r);
      }
    };
    walk(ipcBaseDir, '');
    return results;
  };

  const attachWatchers = (sourceGroup: string) => {
    if (groupWatchers.has(sourceGroup)) return;
    groupWatchers.set(sourceGroup, {
      requests: watchGroupDir(ipcBaseDir, sourceGroup, 'requests', deps),
    });
  };

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

  const pollForNewGroups = () => {
    try {
      const groupFolders = scanGroupFolders();
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
    } catch (err) {
      logger.error({ err }, 'IPC poll error');
    }
    setTimeout(pollForNewGroups, IPC_POLL_INTERVAL);
  };

  setTimeout(pollForNewGroups, IPC_POLL_INTERVAL);
  logger.info('IPC watcher started (inotify + fallback poll for new groups)');
}
