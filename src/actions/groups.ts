import { z } from 'zod';

import { Action } from '../action-registry.js';
import { writeCommandsXml } from '../commands/index.js';
import { isValidGroupFolder } from '../group-folder.js';
import { logger } from '../logger.js';

export const refreshGroups: Action = {
  name: 'refresh_groups',
  description: 'Refresh group metadata from channels',
  input: z.object({}),
  async handler(_input, ctx) {
    if (!ctx.isRoot) throw new Error('unauthorized');
    logger.info(
      { sourceGroup: ctx.sourceGroup },
      'group metadata refresh requested',
    );
    await ctx.syncGroupMetadata(true);
    const groups = ctx.getAvailableGroups();
    ctx.writeGroupsSnapshot(
      ctx.sourceGroup,
      groups,
      new Set(Object.keys(ctx.registeredGroups())),
    );
    return { refreshed: true };
  },
};

export const registerGroup: Action = {
  name: 'register_group',
  description: 'Register a new group for agent responses',
  input: z.object({
    jid: z.string(),
    name: z.string(),
    folder: z.string(),
    trigger: z.string(),
    requiresTrigger: z.boolean().optional(),
    containerConfig: z.record(z.string(), z.unknown()).optional(),
  }),
  async handler(raw, ctx) {
    if (!ctx.isRoot) throw new Error('unauthorized');
    const input = raw as {
      jid: string;
      name: string;
      folder: string;
      trigger: string;
      requiresTrigger?: boolean;
      containerConfig?: Record<string, unknown>;
    };
    if (!isValidGroupFolder(input.folder)) {
      throw new Error('invalid folder name');
    }
    ctx.registerGroup(input.jid, {
      name: input.name,
      folder: input.folder,
      trigger: input.trigger,
      added_at: new Date().toISOString(),
      containerConfig: input.containerConfig as any,
      requiresTrigger: input.requiresTrigger,
    });
    writeCommandsXml(input.folder);
    return { registered: true };
  },
};
