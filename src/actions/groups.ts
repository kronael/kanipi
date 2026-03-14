import { z } from 'zod';

import { Action } from '../action-registry.js';
import { writeCommandsXml } from '../commands/index.js';
import {
  addRoute,
  deleteRoute,
  getAllRoutes,
  getMessageById,
  getRouteById,
  getRoutesForJid,
} from '../db.js';
import { isValidGroupFolder } from '../group-folder.js';
import { logger } from '../logger.js';
import { isDirectChild } from '../permissions.js';
import { isAuthorizedRoutingTarget } from '../router.js';
import { ContainerConfigSchema } from '../types.js';

const MAX_DELEGATE_DEPTH = 1;

export const refreshGroups: Action = {
  name: 'refresh_groups',
  description: 'Refresh group metadata from channels',
  maxTier: 0,
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
      new Set(ctx.getRoutedJids()),
    );
    return { refreshed: true };
  },
};

const RegisterGroupSchema = z.object({
  jid: z.string().min(1),
  name: z.string().min(1),
  folder: z.string().min(1),
  containerConfig: ContainerConfigSchema.optional(),
  parent: z.string().min(1).optional(),
});

export const registerGroup: Action = {
  name: 'register_group',
  description: 'Register a new group for agent responses',
  maxTier: 1,
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
    if (input.folder.split('/').length > 3) {
      throw new Error('folder depth exceeds maximum (3 levels)');
    }

    if (isDirectChild(ctx.sourceGroup, input.folder)) {
      const src = ctx.getGroupConfig(ctx.sourceGroup);
      const max = src?.maxChildren ?? 50;
      if (max === 0) {
        return {
          registered: false,
          reason: 'spawning_disabled',
          fallback: ctx.sourceGroup,
        };
      }
      const n = ctx.getDirectChildGroupCount(ctx.sourceGroup);
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
      added_at: new Date().toISOString(),
      containerConfig: input.containerConfig,
      parent: input.parent,
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

    const workerLocalJid = `local:${ctx.sourceGroup}`;
    let originalBlock = '';
    if (ctx.messageId) {
      const msg = getMessageById(ctx.messageId);
      if (msg) {
        const content =
          msg.content.length > 200
            ? msg.content.slice(0, 200) + '...'
            : msg.content;
        originalBlock =
          `\n  <original_message sender="${msg.sender_name}" id="${msg.id}">` +
          `${content}</original_message>`;
      }
    }
    const wrappedPrompt =
      `<escalation from="${ctx.sourceGroup}" reply_to="${ctx.chatJid}"` +
      ` reply_id="${ctx.messageId ?? ''}">` +
      originalBlock +
      `\n  ${input.prompt}\n</escalation>`;

    logger.info(
      { sourceGroup: ctx.sourceGroup, parent, depth },
      'escalating to parent group',
    );
    await ctx.delegateToParent(
      parent,
      wrappedPrompt,
      workerLocalJid,
      depth + 1,
      undefined,
      { jid: input.chatJid, messageId: ctx.messageId },
    );
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
    if (ctx.tier >= 3) throw new Error('unauthorized: workers cannot delegate');
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
      ctx.messageId,
    );
    return { queued: true };
  },
};

const RouteSchema = z.object({
  seq: z.number().int().min(0),
  type: z.enum(['command', 'verb', 'pattern', 'keyword', 'sender', 'default']),
  match: z.string().nullable(),
  target: z.string().min(1),
});

const GetRoutesInput = z.object({
  jid: z.string().min(1).optional(),
});

export const getRoutes: Action = {
  name: 'get_routes',
  description:
    'Get routing rules. Pass jid ($NANOCLAW_CHAT_JID) to filter, omit for all routes.',
  maxTier: 1,
  input: GetRoutesInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = GetRoutesInput.parse(raw);
    if (input.jid) {
      return { jid: input.jid, routes: getRoutesForJid(input.jid) };
    }
    return { routes: getAllRoutes() };
  },
};

const AddRouteInput = z.object({
  jid: z.string().min(1),
  route: RouteSchema,
});

export const addRouteAction: Action = {
  name: 'add_route',
  description:
    'Add a routing rule for a JID. Use $NANOCLAW_CHAT_JID for the current chat.',
  maxTier: 1,
  input: AddRouteInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = AddRouteInput.parse(raw);
    if (!isAuthorizedRoutingTarget(ctx.sourceGroup, input.route.target)) {
      throw new Error(
        `unauthorized: ${ctx.sourceGroup} cannot route to ${input.route.target}`,
      );
    }
    logger.info({ jid: input.jid, route: input.route }, 'add_route');
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
  maxTier: 1,
  input: DeleteRouteInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 2) throw new Error('unauthorized');
    const input = DeleteRouteInput.parse(raw);
    const route = getRouteById(input.id);
    if (!route) throw new Error(`route not found: ${input.id}`);
    if (
      ctx.tier === 1 &&
      !isAuthorizedRoutingTarget(ctx.sourceGroup, route.target)
    ) {
      throw new Error(
        `unauthorized: ${ctx.sourceGroup} cannot delete route to ${route.target}`,
      );
    }
    logger.info({ id: input.id }, 'delete_route');
    deleteRoute(input.id);
    return { deleted: true, id: input.id };
  },
};
