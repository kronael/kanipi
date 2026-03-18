import fs from 'fs';
import path from 'path';

import {
  AttachmentBuilder,
  Client,
  GatewayIntentBits,
  Message,
  MessageReferenceType,
  TextChannel,
} from 'discord.js';

import {
  AttachmentDownloader,
  AttachmentType,
  RawAttachment,
} from '../mime.js';
import { logger } from '../logger.js';
import { Channel, ChannelOpts, Platform, SendOpts, Verb } from '../types.js';

export class DiscordChannel implements Channel {
  name = 'discord';

  private client: Client | null = null;
  private opts: ChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: ChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    return new Promise<void>((resolve, reject) => {
      this.client!.once('ready', (c) => {
        logger.info(
          { username: c.user.tag, id: c.user.id },
          'Discord bot connected',
        );
        console.log(`\n  Discord bot: ${c.user.tag}`);
        console.log(`  Send !chatid in a channel to get registration ID\n`);
        resolve();
      });

      this.client!.on('error', (err) => {
        logger.fatal({ err: err.message }, 'Discord client error, exiting');
        process.exit(1);
      });

      this.client!.on('messageCreate', (msg) => this.handleMessage(msg));

      this.client!.login(this.botToken).catch(reject);
    });
  }

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;

    const chatJid = `discord:${msg.channelId}`;
    const timestamp = msg.createdAt.toISOString();
    const senderName = msg.member?.displayName || msg.author.displayName;
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
    const botId = this.client?.user?.id;
    const mentionsBot = !!(botId && content.includes(`<@${botId}>`));
    if (mentionsBot) {
      content = content.replace(`<@${botId!}>`, '').trim();
    }

    // Build raw attachment list from discord message attachments
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
      if (contentLength > maxBytes) {
        throw new Error(`file too large: ${contentLength} > ${maxBytes}`);
      }
      return Buffer.from(await res.arrayBuffer());
    };

    // Extract forward/reply metadata
    let forwarded_from: string | undefined;
    let reply_to_text: string | undefined;
    let reply_to_sender: string | undefined;
    let reply_to_id: string | undefined;
    if (msg.reference) {
      if (msg.reference.type === MessageReferenceType.Forward) {
        forwarded_from = '(forwarded)';
      } else {
        reply_to_id = msg.reference.messageId ?? undefined;
        try {
          const ref = await msg.fetchReference();
          reply_to_sender = ref.member?.displayName || ref.author.displayName;
          if (ref.content) reply_to_text = ref.content.slice(0, 100);
        } catch {
          /* referenced message may be deleted */
        }
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
        forwarded_from,
        reply_to_text,
        reply_to_sender,
        reply_to_id,
        verb: Verb.Message,
        platform: Platform.Discord,
        mentions_me: mentionsBot || undefined,
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
      if (!ch?.isTextBased()) {
        logger.warn({ jid }, 'Discord channel not text-based');
        return undefined;
      }
      const MAX = 2000;
      let lastId: string | undefined;
      for (let i = 0; i < text.length; i += MAX) {
        const chunk = text.slice(i, i + MAX);
        if (opts?.replyTo && i === 0) {
          const sent = await (ch as TextChannel).send({
            content: chunk,
            reply: { messageReference: opts.replyTo },
          });
          lastId = sent.id;
        } else {
          const sent = await (ch as TextChannel).send(chunk);
          lastId = sent.id;
        }
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
      if (!ch?.isTextBased()) {
        logger.warn({ jid }, 'Discord channel not text-based');
        return;
      }
      const name = filename ?? path.basename(filePath);
      const attachment = new AttachmentBuilder(fs.createReadStream(filePath), {
        name,
      });
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
      logger.info('Discord bot stopped');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.client || !isTyping) return;
    try {
      const ch = await this.client.channels.fetch(jid.replace(/^discord:/, ''));
      if (ch?.isTextBased()) {
        await (ch as TextChannel).sendTyping();
      }
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Discord typing indicator');
    }
  }
}
