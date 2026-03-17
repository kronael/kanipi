import { z } from 'zod';

import { Action } from '../action-registry.js';
import { logger } from '../logger.js';

const SendMessageInput = z.object({
  chatJid: z.string(),
  text: z.string(),
  sender: z.string().optional(),
  replyTo: z.string().optional(),
});

export const sendMessage: Action = {
  name: 'send_message',
  description: 'Send text to a channel',
  input: SendMessageInput,
  async handler(raw, ctx) {
    const input = SendMessageInput.parse(raw);
    const messageId = await ctx.sendMessage(
      input.chatJid,
      input.text,
      input.replyTo ? { replyTo: input.replyTo } : undefined,
    );
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC message sent',
    );
    return { sent: true, messageId };
  },
};

const SendFileInput = z.object({
  chatJid: z.string(),
  filepath: z.string(),
  filename: z.string().optional(),
});

const SendReplyInput = z.object({
  text: z.string(),
});

export const sendReply: Action = {
  name: 'send_reply',
  description: 'Reply to the current conversation.',
  input: SendReplyInput,
  async handler(raw, ctx) {
    const input = SendReplyInput.parse(raw);
    if (!ctx.chatJid) throw new Error('no bound chat JID');
    const messageId = await ctx.sendMessage(
      ctx.chatJid,
      input.text,
      ctx.messageId ? { replyTo: ctx.messageId } : undefined,
    );
    logger.info(
      { chatJid: ctx.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC reply sent',
    );
    return { sent: true, messageId };
  },
};

export const sendFile: Action = {
  name: 'send_file',
  description: 'Send a file to a channel',
  input: SendFileInput,
  async handler(raw, ctx) {
    const input = SendFileInput.parse(raw);
    await ctx.sendDocument(input.chatJid, input.filepath, input.filename);
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC file sent',
    );
    return { sent: true };
  },
};
