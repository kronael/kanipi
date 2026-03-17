import { getJidsForFolder } from '../db.js';
import { storeOutbound } from '../db.js';
import { logger } from '../logger.js';
import { Channel } from '../types.js';

let channels: Channel[] = [];

export function setNotifyChannels(ch: Channel[]): void {
  channels = ch;
}

function findChannel(jid: string): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}

export async function notify(text: string): Promise<void> {
  const jids = getJidsForFolder('root');
  for (const jid of jids) {
    const channel = findChannel(jid);
    if (!channel) continue;
    try {
      await channel.sendMessage(jid, text);
      storeOutbound({
        chatJid: jid,
        content: text,
        source: 'control',
        groupFolder: 'root',
      });
    } catch (err) {
      logger.warn({ jid, err }, 'Failed to send control notification');
    }
  }
}
