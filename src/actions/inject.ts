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

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrapInjected(
  content: string,
  sourceGroup: string,
  trusted: boolean,
): string {
  return `<injected_content source_group="${xmlEscape(sourceGroup)}" trusted="${trusted}">\n${xmlEscape(content)}\n</injected_content>`;
}

export const injectMessage: Action = {
  name: 'inject_message',
  description: 'Insert a message into DB without sending to channel',
  input: InjectMessageInput,
  async handler(raw, ctx) {
    const input = InjectMessageInput.parse(raw);
    if (ctx.tier > 1) throw new Error('unauthorized: root/world only');
    const id = `inject-${crypto.randomUUID()}`;
    const trusted = ctx.tier === 0;
    storeMessage({
      id,
      chat_jid: input.chatJid,
      sender: input.sender,
      sender_name: input.senderName,
      content: wrapInjected(input.content, ctx.sourceGroup, trusted),
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
    });
    clearChatErrored(input.chatJid);
    logger.info(
      { id, chatJid: input.chatJid, sourceGroup: ctx.sourceGroup, trusted },
      'Message injected',
    );
    return { injected: true, id };
  },
};
