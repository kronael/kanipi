import { z } from 'zod';

import { Action } from '../action-registry.js';
import { writeCommandsXml } from '../commands/index.js';
import {
  addRoute,
  deleteRoute,
  getRoutesForJid,
  setRoutesForJid,
} from '../db.js';
import { isValidGroupFolder } from '../group-folder.js';
import { logger } from '../logger.js';
import { isDirectChild } from '../permissions.js';
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
      .max(200)
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
      .max(200)
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
  minTier: 0,
  input: z.object({}),
  async handler(_input, ctx) {
    if (ctx.tier !== 0) throw new Error('unauthorized');
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
  minTier: 1,
  input: RegisterGroupSchema,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = RegisterGroupSchema.parse(raw);
    if (ctx.tier === 0 && !input.folder.includes('/')) {
      throw new Error('unauthorized: worlds are CLI-only');
    }
    if (ctx.tier === 1 && !isDirectChild(ctx.sourceGroup, input.folder)) {
      throw new Error('unauthorized: can only create children in own world');
    }
    if (!isValidGroupFolder(input.folder)) {
      throw new Error('invalid folder name');
    }

    if (isDirectChild(ctx.sourceGroup, input.folder)) {
      const groups = ctx.registeredGroups();
      const src = Object.values(groups).find(
        (g) => g.folder === ctx.sourceGroup,
      );
      const max = src?.maxChildren ?? 50;
      if (max === 0) {
        return {
          registered: false,
          reason: 'spawning_disabled',
          fallback: ctx.sourceGroup,
        };
      }
      const n = Object.values(groups).filter((g) =>
        isDirectChild(ctx.sourceGroup, g.folder),
      ).length;
      if (n >= max) {
        logger.warn(
          { sourceGroup: ctx.sourceGroup, n, max },
          'max_children reached',
        );
        return {
          registered: false,
          reason: 'max_children_exceeded',
          fallback: ctx.sourceGroup,
        };
      }
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

const EscalateGroupInput = z.object({
  prompt: z.string().min(1),
  chatJid: z.string().min(1),
  depth: z.number().int().min(0).optional(),
});

export const escalateGroup: Action = {
  name: 'escalate_group',
  description: 'Escalate a prompt to the direct parent group agent',
  input: EscalateGroupInput,
  async handler(raw, ctx) {
    if (ctx.tier < 2) {
      throw new Error('unauthorized: only agent/worker groups can escalate');
    }
    const input = EscalateGroupInput.parse(raw);
    const depth = input.depth ?? 0;
    if (depth >= MAX_DELEGATE_DEPTH) {
      throw new Error(
        `delegation depth ${depth} exceeds limit ${MAX_DELEGATE_DEPTH}`,
      );
    }
    const slash = ctx.sourceGroup.lastIndexOf('/');
    if (slash === -1) {
      throw new Error('unauthorized: no parent group');
    }
    const parent = ctx.sourceGroup.slice(0, slash);
    logger.info(
      { sourceGroup: ctx.sourceGroup, parent, depth },
      'escalating to parent group',
    );
    await ctx.delegateToParent(parent, input.prompt, input.chatJid, depth + 1);
    return { queued: true, parent };
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
    if (ctx.tier === 3)
      throw new Error('unauthorized: workers cannot delegate');
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

const GetRoutingRulesInput = z.object({
  folder: z.string().min(1),
});

export const getRoutingRules: Action = {
  name: 'get_routing_rules',
  description: 'Get routing rules for a group',
  input: GetRoutingRulesInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = GetRoutingRulesInput.parse(raw);
    const groups = ctx.registeredGroups();
    const group = Object.values(groups).find((g) => g.folder === input.folder);
    if (!group) throw new Error(`group not found: ${input.folder}`);
    if (ctx.tier === 1) {
      if (
        input.folder !== ctx.sourceGroup &&
        !isDirectChild(ctx.sourceGroup, input.folder)
      ) {
        throw new Error('unauthorized');
      }
    }
    return { folder: input.folder, rules: group.routingRules ?? [] };
  },
};

const SetRoutingRulesInput = z.object({
  folder: z.string().min(1),
  rules: z.array(RoutingRuleSchema),
});

export const setRoutingRules: Action = {
  name: 'set_routing_rules',
  description: 'Set routing rules for a group',
  input: SetRoutingRulesInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = SetRoutingRulesInput.parse(raw);
    const groups = ctx.registeredGroups();
    const jid = Object.keys(groups).find(
      (k) => groups[k].folder === input.folder,
    );
    if (!jid) throw new Error(`group not found: ${input.folder}`);
    if (ctx.tier === 1) {
      if (
        input.folder !== ctx.sourceGroup &&
        !isDirectChild(ctx.sourceGroup, input.folder)
      ) {
        throw new Error('unauthorized');
      }
    }
    logger.info(
      { folder: input.folder, ruleCount: input.rules.length },
      'setting routing rules',
    );
    ctx.registerGroup(jid, {
      ...groups[jid],
      routingRules: input.rules,
    });
    return { folder: input.folder, rules: input.rules };
  },
};

// --- Flat routing table actions ---

const RouteSchema = z.object({
  seq: z.number().int().min(0),
  type: z.enum(['command', 'verb', 'pattern', 'keyword', 'sender', 'default']),
  match: z.string().nullable(),
  target: z.string().min(1),
});

const GetRoutesInput = z.object({
  jid: z.string().min(1),
});

export const getRoutes: Action = {
  name: 'get_routes',
  description: 'Get routing rules for a JID from the flat routing table',
  input: GetRoutesInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = GetRoutesInput.parse(raw);
    const routes = getRoutesForJid(input.jid);
    return { jid: input.jid, routes };
  },
};

const SetRoutesInput = z.object({
  jid: z.string().min(1),
  routes: z.array(RouteSchema),
});

export const setRoutes: Action = {
  name: 'set_routes',
  description: 'Replace all routing rules for a JID in the flat routing table',
  input: SetRoutesInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = SetRoutesInput.parse(raw);
    // Validate targets are authorized
    for (const r of input.routes) {
      if (!isAuthorizedRoutingTarget(ctx.sourceGroup, r.target)) {
        throw new Error(
          `unauthorized: ${ctx.sourceGroup} cannot route to ${r.target}`,
        );
      }
    }
    logger.info(
      { jid: input.jid, routeCount: input.routes.length },
      'setting routes for JID',
    );
    setRoutesForJid(input.jid, input.routes);
    return { jid: input.jid, routes: input.routes };
  },
};

const AddRouteInput = z.object({
  jid: z.string().min(1),
  route: RouteSchema,
});

export const addRouteAction: Action = {
  name: 'add_route',
  description: 'Add a single routing rule for a JID',
  input: AddRouteInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = AddRouteInput.parse(raw);
    if (!isAuthorizedRoutingTarget(ctx.sourceGroup, input.route.target)) {
      throw new Error(
        `unauthorized: ${ctx.sourceGroup} cannot route to ${input.route.target}`,
      );
    }
    logger.info({ jid: input.jid, route: input.route }, 'adding route for JID');
    const id = addRoute(input.jid, input.route);
    return { jid: input.jid, id, route: input.route };
  },
};

const DeleteRouteInput = z.object({
  id: z.number().int().min(1),
});

export const deleteRouteAction: Action = {
  name: 'delete_route',
  description: 'Delete a routing rule by ID',
  input: DeleteRouteInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = DeleteRouteInput.parse(raw);
    logger.info({ id: input.id }, 'deleting route');
    deleteRoute(input.id);
    return { deleted: true, id: input.id };
  },
};
