import { logger } from '../logger.js';
import { Channel, NewMessage, OnChatMetadata, OnInboundMessage } from '../types.js';

const API_BASE = 'https://api.telegram.org/bot';

export interface TelegramChannelOpts {
  token: string;
  pollingTimeout?: number;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private token: string;
  private pollingTimeout: number;
  private offset = 0;
  private connected = false;
  private abortController: AbortController | null = null;
  private opts: TelegramChannelOpts;

  constructor(opts: TelegramChannelOpts) {
    this.token = opts.token;
    this.pollingTimeout = opts.pollingTimeout ?? 30;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    const me = await this.apiCall('getMe');
    if (!me.ok) throw new Error(`Telegram auth failed: ${JSON.stringify(me)}`);
    logger.info({ botUsername: me.result.username }, 'Telegram bot connected');
    this.connected = true;
    this.pollLoop();
  }

  private async apiCall(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<any> {
    const url = `${API_BASE}${this.token}/${method}`;
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: this.abortController?.signal,
    });
    return res.json();
  }

  private async pollLoop(): Promise<void> {
    this.abortController = new AbortController();

    while (this.connected) {
      try {
        const data = await this.apiCall('getUpdates', {
          offset: this.offset,
          timeout: this.pollingTimeout,
          allowed_updates: ['message'],
        });

        if (!data.ok) {
          logger.error({ error: data }, 'Telegram getUpdates failed');
          await this.sleep(5000);
          continue;
        }

        for (const update of data.result) {
          this.offset = update.update_id + 1;
          if (update.message) {
            this.handleMessage(update.message);
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') break;
        logger.error({ err }, 'Telegram polling error');
        await this.sleep(5000);
      }
    }
  }

  private handleMessage(msg: any): void {
    const chatId = String(msg.chat.id);
    const peerId = `tg:${chatId}`;
    const isGroup =
      msg.chat.type === 'group' || msg.chat.type === 'supergroup';
    const timestamp = new Date(msg.date * 1000).toISOString();
    const senderName = msg.from?.first_name
      ? `${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}`
      : String(msg.from?.id ?? 'unknown');
    const content = msg.text ?? msg.caption ?? '';

    if (!content) return;

    this.opts.onChatMetadata(
      peerId,
      timestamp,
      msg.chat.title ?? senderName,
      'telegram',
      isGroup,
    );

    this.opts.onMessage(peerId, {
      id: String(msg.message_id),
      chat_jid: peerId,
      sender: String(msg.from?.id ?? ''),
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
      is_bot_message: msg.from?.is_bot ?? false,
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = jid.replace(/^tg:/, '');
    await this.apiCall('sendMessage', {
      chat_id: chatId,
      text,
    });
    logger.info({ chatId, length: text.length }, 'Telegram message sent');
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
  }

  async setTyping(jid: string, _isTyping: boolean): Promise<void> {
    const chatId = jid.replace(/^tg:/, '');
    try {
      await this.apiCall('sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      });
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send typing action');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
