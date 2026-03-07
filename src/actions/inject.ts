import crypto from 'crypto';

import { z } from 'zod';

import { Action } from '../action-registry.js';
import { clearChatErrored, storeMessage } from '../db.js';
import { logger } from '../logger.js';

const InjectMessageInput = z.object({
  chatJid: z.string(),
  content: z.string(),
  sender: z.string().optional().default('system'),
  senderName: z.string().optional().default('system'),
});

export const injectMessage: Action = {
  name: 'inject_message',
  description:
    'Insert a message into DB without sending to channel (root/world only)',
  input: InjectMessageInput,
  async handler(raw, ctx) {
    const input = InjectMessageInput.parse(raw);
    if (ctx.tier > 1) throw new Error('unauthorized: root/world only');
    const id = `inject-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
    const timestamp = new Date().toISOString();
    storeMessage({
      id,
      chat_jid: input.chatJid,
      sender: input.sender,
      sender_name: input.senderName,
      content: input.content,
      timestamp,
      is_from_me: false,
      is_bot_message: false,
    });
    clearChatErrored(input.chatJid);
    logger.info(
      { id, chatJid: input.chatJid, sourceGroup: ctx.sourceGroup },
      'Message injected',
    );
    return { injected: true, id, timestamp };
  },
};
