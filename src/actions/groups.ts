import { z } from 'zod';

import { Action } from '../action-registry.js';
import { writeCommandsXml } from '../commands/index.js';
import { isValidGroupFolder } from '../group-folder.js';
import { logger } from '../logger.js';
import { isAuthorizedRoutingTarget } from '../router.js';
import { ContainerConfigSchema } from '../types.js';

const MAX_DELEGATE_DEPTH = 3;

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
  containerConfig: ContainerConfigSchema.optional(),
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
      containerConfig: input.containerConfig,
      requiresTrigger: input.requiresTrigger,
      parent: input.parent,
      routingRules: input.routingRules,
    });
    writeCommandsXml(input.folder);
    return { registered: true };
  },
};

const DelegateGroupInput = z.object({
  group: z.string().min(1),
  prompt: z.string().min(1),
  chatJid: z.string().min(1),
  depth: z.number().int().min(0).optional(),
});

export const delegateGroup: Action = {
  name: 'delegate_group',
  description: 'Delegate a prompt to a registered child group agent',
  input: DelegateGroupInput,
  async handler(raw, ctx) {
    const input = DelegateGroupInput.parse(raw);
    const depth = input.depth ?? 0;

    if (depth >= MAX_DELEGATE_DEPTH) {
      throw new Error(
        `delegation depth ${depth} exceeds limit ${MAX_DELEGATE_DEPTH}`,
      );
    }

    if (!isAuthorizedRoutingTarget(ctx.sourceGroup, input.group)) {
      throw new Error(
        `unauthorized: ${ctx.sourceGroup} cannot delegate to ${input.group}`,
      );
    }

    logger.info(
      { sourceGroup: ctx.sourceGroup, child: input.group, depth },
      'delegating to child group',
    );

    await ctx.delegateToChild(
      input.group,
      input.prompt,
      input.chatJid,
      depth + 1,
    );
    return { queued: true };
  },
};

const SetRoutingRulesInput = z.object({
  folder: z.string().min(1),
  rules: z.array(RoutingRuleSchema),
});

export const setRoutingRules: Action = {
  name: 'set_routing_rules',
  description: 'Set routing rules for a parent group',
  input: SetRoutingRulesInput,
  async handler(raw, ctx) {
    if (!ctx.isRoot) throw new Error('unauthorized');
    const input = SetRoutingRulesInput.parse(raw);
    const groups = ctx.registeredGroups();
    const jid = Object.keys(groups).find(
      (k) => groups[k].folder === input.folder,
    );
    if (!jid) throw new Error(`group not found: ${input.folder}`);
    logger.info(
      { folder: input.folder, ruleCount: input.rules.length },
      'setting routing rules',
    );
    ctx.registerGroup(jid, {
      ...groups[jid],
      routingRules: input.rules,
    });
    return { updated: true, ruleCount: input.rules.length };
  },
};
