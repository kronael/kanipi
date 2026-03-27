import fs from 'fs';
import path from 'path';

import WebSocket from 'ws';

import { logger } from '../logger.js';
import { Channel, ChannelOpts, Platform, SendOpts, Verb } from '../types.js';

const MAX_MESSAGE_LEN = 4000;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

export class SlackUserChannel implements Channel {
  name = 'slack-user';

  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private opts: ChannelOpts;
  private token: string; // xoxc-...
  private cookie: string; // xoxd-... (value of the d cookie)

  constructor(token: string, cookie: string, opts: ChannelOpts) {
    this.token = token;
    this.cookie = cookie;
    this.opts = opts;
  }

  private async api(
    method: string,
    params: Record<string, string> = {},
  ): Promise<any> {
    const body = new URLSearchParams({ token: this.token, ...params });
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `d=${this.cookie}`,
      },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as any;
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
    return data;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    const auth = await this.api('auth.test');
    this.userId = auth.user_id as string;
    const rtm = await this.api('rtm.connect');
    await this.connectWs(rtm.url as string);
    logger.info(
      { userId: this.userId, user: auth.user },
      'Slack user connected',
    );
  }

  private connectWs(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        headers: { Cookie: `d=${this.cookie}` },
      });
      this.ws = ws;
      let resolved = false;

      ws.once('open', () => {
        resolved = true;
        this.reconnectAttempt = 0;
        resolve();
      });

      ws.once('error', (err) => {
        if (!resolved) reject(err);
        else logger.warn({ err: (err as Error).message }, 'Slack WS error');
      });

      ws.on('close', () => {
        if (!this.stopped) this.scheduleReconnect();
      });

      ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this.handleEvent(event).catch((err) =>
            logger.error({ err }, 'Slack event handler error'),
          );
        } catch {
          /* ignore malformed frames */
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;
    logger.warn(
      { delay, attempt: this.reconnectAttempt },
      'Slack WS closed, reconnecting',
    );
    this.reconnectTimer = setTimeout(async () => {
      try {
        const rtm = await this.api('rtm.connect');
        await this.connectWs(rtm.url as string);
      } catch (err) {
        logger.error({ err }, 'Slack reconnect failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async handleEvent(event: any): Promise<void> {
    if (event.type !== 'message') return;
    if (event.subtype) return; // skip edits, deletions, bot_messages
    if (!event.user || !event.channel || !event.ts) return;
    if (event.user === this.userId) return;

    const chatJid = `slack:${event.channel}`;
    const sender = `slack:${event.user}`;
    const timestamp = new Date(parseFloat(event.ts) * 1000).toISOString();
    const isGroup = event.channel_type !== 'im';

    if (event.text?.trim() === '!chatid') {
      await this.api('chat.postMessage', {
        channel: event.channel,
        text: `Chat ID: \`${chatJid}\``,
      });
      return;
    }

    let senderName: string = event.user;
    try {
      const info = await this.api('users.info', { user: event.user });
      const u = info.user as any;
      senderName = u?.real_name || u?.name || event.user;
    } catch {
      /* best-effort */
    }

    let chatName: string | undefined;
    try {
      const info = await this.api('conversations.info', {
        channel: event.channel,
      });
      const c = info.channel as any;
      chatName = c?.name ? `#${c.name}` : undefined;
    } catch {
      /* best-effort */
    }

    const mentionsMe = !!(
      this.userId && (event.text || '').includes(`<@${this.userId}>`)
    );
    let content = event.text || '';
    if (mentionsMe && this.userId) {
      content = content.replaceAll(`<@${this.userId}>`, '').trim();
    }

    const reply_to_id =
      event.thread_ts && event.thread_ts !== event.ts
        ? event.thread_ts
        : undefined;

    this.opts.onChatMetadata(chatJid, timestamp, chatName, 'slack', isGroup);
    this.opts.onMessage(chatJid, {
      id: event.ts,
      chat_jid: chatJid,
      sender,
      sender_name: senderName,
      content,
      timestamp,
      is_from_me: false,
      verb: Verb.Message,
      platform: Platform.Slack,
      mentions_me: mentionsMe || undefined,
      reply_to_id,
    });

    logger.info(
      { chatJid, chatName, sender: senderName },
      'Slack message stored',
    );
  }

  async sendMessage(
    jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string | undefined> {
    const channel = jid.replace(/^slack:/, '');
    try {
      let lastTs: string | undefined;
      for (let i = 0; i < text.length; i += MAX_MESSAGE_LEN) {
        const chunk = text.slice(i, i + MAX_MESSAGE_LEN);
        const params: Record<string, string> = { channel, text: chunk };
        if (opts?.replyTo && i === 0) params.thread_ts = opts.replyTo;
        const res = await this.api('chat.postMessage', params);
        lastTs = res.ts as string | undefined;
      }
      logger.info({ jid, length: text.length }, 'Slack message sent');
      return lastTs;
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Slack message');
      return undefined;
    }
  }

  async sendDocument(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void> {
    const channel = jid.replace(/^slack:/, '');
    try {
      const name = filename ?? path.basename(filePath);
      const form = new FormData();
      form.append('token', this.token);
      form.append('channels', channel);
      form.append('filename', name);
      form.append(
        'file',
        new Blob([await fs.promises.readFile(filePath)]),
        name,
      );
      const res = await fetch('https://slack.com/api/files.upload', {
        method: 'POST',
        headers: { Cookie: `d=${this.cookie}` },
        body: form,
      });
      const data = (await res.json()) as any;
      if (!data.ok) throw new Error(data.error);
      logger.info({ jid, filePath }, 'Slack file sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Slack file');
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack:');
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      logger.info('Slack user disconnected');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // Slack API does not expose typing indicators for user tokens
  }
}
