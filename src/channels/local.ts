import { ASSISTANT_NAME } from '../config.js';
import { storeMessage, storeChatMetadata } from '../db.js';
import type { Channel, SendOpts } from '../types.js';

export class LocalChannel implements Channel {
  name = 'local';

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  isConnected(): boolean {
    return true;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('local:');
  }

  async setTyping(): Promise<void> {}

  async sendMessage(
    jid: string,
    text: string,
    _opts?: SendOpts,
  ): Promise<string | undefined> {
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = new Date().toISOString();
    storeChatMetadata(jid, ts, undefined, 'local');
    storeMessage({
      id,
      chat_jid: jid,
      sender: ASSISTANT_NAME,
      sender_name: ASSISTANT_NAME,
      content: text,
      timestamp: ts,
      is_from_me: true,
      is_bot_message: true,
    });
    return id;
  }

  async sendDocument(): Promise<void> {
    throw new Error('local: sendDocument not supported');
  }
}
