import { z } from 'zod';

import { Action } from '../action-registry.js';
import { logger } from '../logger.js';

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
    const groups = ctx.registeredGroups();
    const target = groups[input.chatJid];
    const ok =
      input.chatJid &&
      (ctx.isRoot || (target && target.folder === ctx.sourceGroup));
    if (!ok) {
      logger.warn(
        { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
        'unauthorized send_message blocked',
      );
      throw new Error('unauthorized');
    }
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
    const groups = ctx.registeredGroups();
    const target = groups[input.chatJid];
    const ok =
      input.chatJid &&
      (ctx.isRoot || (target && target.folder === ctx.sourceGroup));
    if (!ok) {
      logger.warn(
        { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
        'unauthorized send_file blocked',
      );
      throw new Error('unauthorized');
    }
    // Path translation happens in ipc.ts caller
    await ctx.sendDocument(input.chatJid, input.filepath, input.filename);
    logger.info(
      { chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'IPC file sent',
    );
    return { sent: true };
  },
};
