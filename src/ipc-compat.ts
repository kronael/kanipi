/**
 * Backwards-compat shim for processTaskIpc.
 * Used by ipc-auth.test.ts. New code should use actions directly.
 */
import { ActionContext, getAction } from './action-registry.js';
import { AvailableGroup } from './container-runner.js';
import { isRoot } from './config.js';
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
}

export async function processTaskIpc(
  data: { type: string; [key: string]: unknown },
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  const ctx: ActionContext = {
    sourceGroup,
    isRoot: isRoot(sourceGroup),
    sendMessage: deps.sendMessage,
    sendDocument: deps.sendDocument,
    registeredGroups: deps.registeredGroups,
    registerGroup: deps.registerGroup,
    syncGroupMetadata: deps.syncGroupMetadata,
    getAvailableGroups: deps.getAvailableGroups,
    writeGroupsSnapshot: deps.writeGroupsSnapshot,
    clearSession: deps.clearSession,
  };

  const action = getAction(data.type);
  if (!action) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
    return;
  }

  try {
    await action.handler(data, ctx);
  } catch (err) {
    logger.warn({ type: data.type, err, sourceGroup }, 'Action handler error');
  }
}
