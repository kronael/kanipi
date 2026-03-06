import { z } from 'zod';

import { Action, ActionContext } from '../action-registry.js';
import { logger } from '../logger.js';

function assertAuthorized(
  chatJid: string,
  ctx: ActionContext,
  action: string,
): void {
  const target = ctx.registeredGroups()[chatJid];
  if (chatJid && (ctx.isRoot || (target && target.folder === ctx.sourceGroup)))
    return;
  logger.warn(
    { chatJid, sourceGroup: ctx.sourceGroup },
    `unauthorized ${action} blocked`,
  );
  throw new Error('unauthorized');
}

export const sendMessage: Action = {
  name: 'send_message',
  description: 'Send text to a channel',
  input: z.object({
    chatJid: z.string(),
    text: z.string(),
    sender: z.string().optional(),
  }),
  async handler(raw, ctx) {
    const input = raw as { chatJid: string; text: string };
    assertAuthorized(input.chatJid, ctx, 'send_message');
    await ctx.sendMessage(input.chatJid, input.text);
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC message sent',
    );
    return { sent: true };
  },
};

export const sendFile: Action = {
  name: 'send_file',
  description: 'Send a file to a channel',
  input: z.object({
    chatJid: z.string(),
    filepath: z.string(),
    filename: z.string().optional(),
  }),
  async handler(raw, ctx) {
    const input = raw as {
      chatJid: string;
      filepath: string;
      filename?: string;
    };
    assertAuthorized(input.chatJid, ctx, 'send_file');
    await ctx.sendDocument(input.chatJid, input.filepath, input.filename);
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC file sent',
    );
    return { sent: true };
  },
};
