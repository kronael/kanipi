import fs from 'fs';
import path from 'path';

import {
  Client,
  Message,
  MessageAttachment,
  TextChannel,
} from 'discord.js-selfbot-v13';

import {
  AttachmentDownloader,
  AttachmentType,
  RawAttachment,
} from '../mime.js';
import { logger } from '../logger.js';
import { Channel, ChannelOpts, Platform, SendOpts, Verb } from '../types.js';

// User account (selfbot) Discord channel — uses DISCORD_USER_TOKEN.
// No bot application or intents required; connects as a normal user account.
export class DiscordUserChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: ChannelOpts;
  private userToken: string;

  constructor(userToken: string, opts: ChannelOpts) {
    this.userToken = userToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({});

    return new Promise<void>((resolve, reject) => {
      this.client!.once('ready', (c) => {
        logger.info(
          { username: c.user.tag, id: c.user.id },
          'Discord user connected',
        );
        console.log(`\n  Discord user: ${c.user.tag}`);
        console.log(`  Send !chatid in a channel to get registration ID\n`);
        resolve();
      });

      this.client!.on('error', (err) => {
        logger.fatal(
          { err: (err as Error).message },
          'Discord client error, exiting',
        );
        process.exit(1);
      });

      this.client!.on('messageCreate', (msg) => this.handleMessage(msg));

      this.client!.login(this.userToken).catch(reject);
    });
  }

  private async handleMessage(msg: Message): Promise<void> {
    // Skip own messages
    if (msg.author.id === this.client?.user?.id) return;

    const chatJid = `discord:${msg.channelId}`;
    const timestamp = msg.createdAt.toISOString();
    const senderName = msg.member?.displayName || msg.author.username;
    const sender = `discord:${msg.author.id}`;
    const isGroup = msg.guild !== null;
    const chatName = isGroup
      ? `#${(msg.channel as TextChannel).name}`
      : senderName;

    if (msg.content === '!chatid') {
      msg.reply(`Chat ID: \`${chatJid}\`\nName: ${chatName}`);
      return;
    }

    this.opts.onChatMetadata(chatJid, timestamp, chatName, 'discord', isGroup);

    let content = msg.content;
    const userId = this.client?.user?.id;
    const mentionsMe = !!(userId && content.includes(`<@${userId}>`));
    if (mentionsMe) content = content.replace(`<@${userId!}>`, '').trim();

    const attachments: RawAttachment[] = [];
    for (const att of msg.attachments.values()) {
      let type: AttachmentType = 'document';
      if (att.contentType?.startsWith('image/')) type = 'image';
      else if (att.contentType?.startsWith('video/')) type = 'video';
      else if (att.contentType?.startsWith('audio/')) type = 'audio';
      attachments.push({
        type,
        mimeType: att.contentType || undefined,
        filename: att.name || undefined,
        sizeBytes: att.size,
        source: { kind: 'discord', url: att.url },
      });
    }

    const discordDownload: AttachmentDownloader = async (a, maxBytes) => {
      if (a.source.kind !== 'discord') throw new Error('wrong source kind');
      const res = await fetch(a.source.url);
      if (!res.ok) throw new Error(`discord fetch HTTP ${res.status}`);
      const contentLength = parseInt(
        res.headers.get('content-length') || '0',
        10,
      );
      if (contentLength > maxBytes)
        throw new Error(`file too large: ${contentLength} > ${maxBytes}`);
      return Buffer.from(await res.arrayBuffer());
    };

    let reply_to_text: string | undefined;
    let reply_to_sender: string | undefined;
    let reply_to_id: string | undefined;
    if (msg.reference?.messageId) {
      reply_to_id = msg.reference.messageId;
      try {
        const ref = await msg.fetchReference();
        reply_to_sender = ref.member?.displayName || ref.author.username;
        if (ref.content) reply_to_text = ref.content.slice(0, 100);
      } catch {
        /* referenced message may be deleted */
      }
    }

    this.opts.onMessage(
      chatJid,
      {
        id: msg.id,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
        reply_to_text,
        reply_to_sender,
        reply_to_id,
        verb: Verb.Message,
        platform: Platform.Discord,
        mentions_me: mentionsMe || undefined,
      },
      attachments.length > 0 ? attachments : undefined,
      attachments.length > 0 ? discordDownload : undefined,
    );

    logger.info(
      { chatJid, chatName, sender: senderName },
      'Discord message stored',
    );
  }

  async sendMessage(
    jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string | undefined> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return undefined;
    }
    try {
      const ch = await this.client.channels.fetch(jid.replace(/^discord:/, ''));
      if (!ch?.isText()) {
        logger.warn({ jid }, 'Discord channel not text-based');
        return undefined;
      }
      const MAX = 2000;
      let lastId: string | undefined;
      for (let i = 0; i < text.length; i += MAX) {
        const chunk = text.slice(i, i + MAX);
        const sent = await (ch as TextChannel).send(
          opts?.replyTo && i === 0
            ? { content: chunk, reply: { messageReference: opts.replyTo } }
            : chunk,
        );
        lastId = sent.id;
      }
      logger.info({ jid, length: text.length }, 'Discord message sent');
      return lastId;
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Discord message');
      return undefined;
    }
  }

  async sendDocument(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void> {
    if (!this.client) {
      logger.warn('Discord client not initialized');
      return;
    }
    try {
      const ch = await this.client.channels.fetch(jid.replace(/^discord:/, ''));
      if (!ch?.isText()) {
        logger.warn({ jid }, 'Discord channel not text-based');
        return;
      }
      const name = filename ?? path.basename(filePath);
      const attachment = new MessageAttachment(
        fs.createReadStream(filePath),
        name,
      );
      await (ch as TextChannel).send({ files: [attachment] });
      logger.info({ jid, filePath, name }, 'Discord document sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Discord document');
    }
  }

  isConnected(): boolean {
    return this.client?.isReady() ?? false;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('discord:');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Discord user disconnected');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const ch = await this.client.channels.fetch(jid.replace(/^discord:/, ''));
      if (ch?.isText()) await (ch as TextChannel).sendTyping();
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}
