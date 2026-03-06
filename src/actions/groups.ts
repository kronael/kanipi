import { z } from 'zod';

import { Action } from '../action-registry.js';
import { writeCommandsXml } from '../commands/index.js';
import { isValidGroupFolder } from '../group-folder.js';
import { logger } from '../logger.js';

const RoutingRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command'),
    trigger: z.string().min(1),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('pattern'),
    pattern: z
      .string()
      .min(1)
      .superRefine((val, ctx) => {
        try {
          new RegExp(val);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'invalid regex',
          });
        }
      }),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('keyword'),
    keyword: z.string().min(1),
    target: z.string().min(1),
  }),
  z.object({
    type: z.literal('sender'),
    pattern: z
      .string()
      .min(1)
      .superRefine((val, ctx) => {
        try {
          new RegExp(val);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'invalid regex',
          });
        }
      }),
    target: z.string().min(1),
  }),
  z.object({ type: z.literal('default'), target: z.string().min(1) }),
]);

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

const RegisterGroupSchema = z.object({
  jid: z.string().min(1),
  name: z.string().min(1),
  folder: z.string().min(1),
  trigger: z.string(),
  requiresTrigger: z.boolean().optional(),
  containerConfig: z.record(z.string(), z.unknown()).optional(),
  parent: z.string().min(1).optional(),
  routingRules: z.array(RoutingRuleSchema).optional(),
});

export const registerGroup: Action = {
  name: 'register_group',
  description: 'Register a new group for agent responses',
  input: RegisterGroupSchema,
  async handler(raw, ctx) {
    if (!ctx.isRoot) throw new Error('unauthorized');
    const input = RegisterGroupSchema.parse(raw);
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
      parent: input.parent,
      routingRules: input.routingRules,
    });
    writeCommandsXml(input.folder);
    return { registered: true };
  },
};

export const setRoutingRules: Action = {
  name: 'set_routing_rules',
  description: 'Set routing rules for a parent group',
  input: z.object({
    folder: z.string().min(1),
    rules: z.array(RoutingRuleSchema),
  }),
  async handler(raw, ctx) {
    if (!ctx.isRoot) throw new Error('unauthorized');
    const parsed = raw as {
      folder: string;
      rules: import('../types.js').RoutingRule[];
    };
    const groups = ctx.registeredGroups();
    const jid = Object.keys(groups).find(
      (k) => groups[k].folder === parsed.folder,
    );
    if (!jid) throw new Error(`group not found: ${parsed.folder}`);
    logger.info(
      { folder: parsed.folder, ruleCount: parsed.rules.length },
      'setting routing rules',
    );
    ctx.registerGroup(jid, {
      ...groups[jid],
      routingRules: parsed.rules,
    });
    return { updated: true, ruleCount: parsed.rules.length };
  },
};
