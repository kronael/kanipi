/**
 * Backwards-compat shim for processTaskIpc.
 * Used by ipc-auth.test.ts. New code should use actions directly.
 */
import { getAction } from './action-registry.js';
import { isRoot, permissionTier } from './config.js';
import { logger } from './logger.js';

export type { IpcDeps } from './ipc.js';

import type { IpcDeps } from './ipc.js';

export async function processTaskIpc(
  data: { type: string; [key: string]: unknown },
  sourceGroup: string,
  deps: IpcDeps,
): Promise<void> {
  const action = getAction(data.type);
  if (!action) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
    return;
  }

  try {
    await action.handler(data, {
      sourceGroup,
      isRoot: isRoot(sourceGroup),
      tier: permissionTier(sourceGroup),
      ...deps,
    });
  } catch (err) {
    logger.warn({ type: data.type, err, sourceGroup }, 'Action handler error');
  }
}
