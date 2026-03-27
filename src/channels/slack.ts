import fs from 'fs';
import path from 'path';

import { App, LogLevel } from '@slack/bolt';

import { logger } from '../logger.js';
import { Channel, ChannelOpts, Platform, SendOpts, Verb } from '../types.js';

export class SlackChannel implements Channel {
  name = 'slack';

  private app: App | null = null;
  private opts: ChannelOpts;
  private botToken: string;
  private appToken: string;
  private botUserId: string | null = null;

  constructor(botToken: string, appToken: string, opts: ChannelOpts) {
    this.botToken = botToken;
    this.appToken = appToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
      logLevel: LogLevel.WARN,
    });

    const authTest = await this.app.client.auth.test();
    this.botUserId = authTest.user_id as string;

    this.app.message(async ({ message }) => {
      const msg = message as any;
      // Skip bot/system messages
      if (msg.subtype === 'bot_message' || msg.bot_id) return;
      if (msg.user === this.botUserId) return;

      const chatJid = `slack:${msg.channel}`;
      const sender = `slack:${msg.user}`;
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();

      let senderName: string = msg.user;
      try {
        const info = await this.app!.client.users.info({ user: msg.user });
        const u = info.user as any;
        senderName = u?.real_name || u?.name || msg.user;
      } catch {
        /* best-effort */
      }

      let chatName: string | undefined;
      try {
        const info = await this.app!.client.conversations.info({
          channel: msg.channel,
        });
        const c = info.channel as any;
        chatName = c?.name ? `#${c.name}` : undefined;
      } catch {
        /* best-effort */
      }

      const mentionsMe = !!(
        this.botUserId && (msg.text || '').includes(`<@${this.botUserId}>`)
      );
      const content = (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

      this.opts.onChatMetadata(chatJid, timestamp, chatName, 'slack', true);
      this.opts.onMessage(chatJid, {
        id: msg.ts,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
        verb: Verb.Message,
        platform: Platform.Slack,
        mentions_me: mentionsMe || undefined,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Slack message stored',
      );
    });

    await this.app.start();
    logger.info({ botUserId: this.botUserId }, 'Slack connected');
  }

  async sendMessage(
    jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string | undefined> {
    if (!this.app) return undefined;
    const channel = jid.replace(/^slack:/, '');
    try {
      const res = await this.app.client.chat.postMessage({
        channel,
        text,
        ...(opts?.replyTo ? { thread_ts: opts.replyTo } : {}),
      });
      return res.ts as string | undefined;
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
    if (!this.app) return;
    const channel = jid.replace(/^slack:/, '');
    try {
      await this.app.client.files.upload({
        channels: channel,
        filename: filename ?? path.basename(filePath),
        file: fs.createReadStream(filePath),
      });
      logger.info({ jid, filePath }, 'Slack file sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Slack file');
    }
  }

  isConnected(): boolean {
    return this.app !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack:');
  }

  async disconnect(): Promise<void> {
    if (this.app) {
      await this.app.stop();
      this.app = null;
      logger.info('Slack disconnected');
    }
  }

  async setTyping(): Promise<void> {
    // Slack bot API does not support typing indicators
  }
}
