import { ArizukaConfig } from '../config.js';
import { logger } from '../logger.js';
import { Channel, OnChatMetadata, OnInboundMessage, RegisteredGroup } from '../types.js';
import { TelegramChannel } from './telegram.js';
import { WhatsAppChannel } from './whatsapp.js';

export interface ChannelCallbacks {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export async function createChannels(
  config: ArizukaConfig,
  callbacks: ChannelCallbacks,
): Promise<Channel[]> {
  const channels: Channel[] = [];

  if (config.channels.whatsapp?.enabled) {
    const wa = new WhatsAppChannel({
      ...callbacks,
      assistantName: config.assistant.name,
      hasOwnNumber: config.channels.whatsapp.hasOwnNumber ?? false,
    });
    await wa.connect();
    channels.push(wa);
    logger.info('WhatsApp channel enabled');
  }

  if (config.channels.telegram?.enabled) {
    const tg = new TelegramChannel({
      ...callbacks,
      token: config.channels.telegram.token,
      pollingTimeout: config.channels.telegram.pollingTimeout,
    });
    await tg.connect();
    channels.push(tg);
    logger.info('Telegram channel enabled');
  }

  return channels;
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
