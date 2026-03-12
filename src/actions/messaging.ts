import { z } from 'zod';

import { Action, ActionContext } from '../action-registry.js';
import { logger } from '../logger.js';
import { isInWorld } from '../permissions.js';

function assertAuthorized(
  chatJid: string,
  ctx: ActionContext,
  action: string,
): void {
  if (ctx.tier === 0) return;
  const targetFolder = ctx.getDefaultTarget(chatJid);
  if (targetFolder && isInWorld(ctx.sourceGroup, targetFolder)) return;
  logger.warn(
    { chatJid, sourceGroup: ctx.sourceGroup },
    `unauthorized ${action} blocked`,
  );
  throw new Error('unauthorized');
}

const SendMessageInput = z.object({
  chatJid: z.string(),
  text: z.string(),
  sender: z.string().optional(),
});

export const sendMessage: Action = {
  name: 'send_message',
  description: 'Send text to a channel',
  input: SendMessageInput,
  async handler(raw, ctx) {
    const input = SendMessageInput.parse(raw);
    assertAuthorized(input.chatJid, ctx, 'send_message');
    await ctx.sendMessage(input.chatJid, input.text);
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC message sent',
    );
    return { sent: true };
  },
};

const SendFileInput = z.object({
  chatJid: z.string(),
  filepath: z.string(),
  filename: z.string().optional(),
});

export const sendFile: Action = {
  name: 'send_file',
  description: 'Send a file to a channel',
  input: SendFileInput,
  async handler(raw, ctx) {
    if (ctx.tier >= 3)
      throw new Error('unauthorized: workers cannot send files');
    const input = SendFileInput.parse(raw);
    assertAuthorized(input.chatJid, ctx, 'send_file');
    await ctx.sendDocument(input.chatJid, input.filepath, input.filename);
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC file sent',
    );
    return { sent: true };
  },
};
