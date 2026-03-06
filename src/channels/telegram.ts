import fs from 'fs';
import path from 'path';

import { Bot, InputFile } from 'grammy';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import {
  AttachmentDownloader,
  AttachmentType,
  RawAttachment,
} from '../mime.js';
import { logger } from '../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../types.js';

function mdToHtml(text: string): string {
  // Extract fenced code blocks before any other processing
  const blocks: string[] = [];
  const withPlaceholders = text.replace(/```[\s\S]*?```/g, (match) => {
    const content = match.slice(3, -3).replace(/^[^\n]*\n?/, ''); // strip lang tag
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    blocks.push(`<pre>${escaped}</pre>`);
    return `\x00BLOCK${blocks.length - 1}\x00`;
  });

  // Escape HTML in remaining text, then apply inline markdown
  const escaped = withPlaceholders
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const inline = escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/_(.+?)_/g, '<i>$1</i>')
    .replace(/^#{1,6} (.+)$/gm, '<b>$1</b>');

  // Reinsert code blocks
  return inline.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[parseInt(i)]);
}

export class TelegramChannel implements Channel {
  name = 'telegram';

  private bot: Bot | null = null;
  private opts: ChannelOpts;
  private botToken: string;

  constructor(botToken: string, opts: ChannelOpts) {
    this.botToken = botToken;
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.bot = new Bot(this.botToken);

    this.bot.on('message:text', async (ctx) => {
      const chatJid = `tg:${ctx.chat.id}`;
      let content = ctx.message.text;
      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id.toString() ||
        'Unknown';
      const sender = ctx.from?.id.toString() || '';
      const msgId = ctx.message.message_id.toString();

      // Determine chat name
      const chatName =
        ctx.chat.type === 'private'
          ? senderName
          : (ctx.chat as any).title || chatJid;

      // Translate Telegram @bot_username mentions into TRIGGER_PATTERN format.
      // Telegram @mentions (e.g., @andy_ai_bot) won't match TRIGGER_PATTERN
      // (e.g., ^@Andy\b), so we prepend the trigger when the bot is @mentioned.
      const botUsername = ctx.me?.username?.toLowerCase();
      if (botUsername) {
        const entities = ctx.message.entities || [];
        const isBotMentioned = entities.some((entity) => {
          if (entity.type === 'mention') {
            const mentionText = content
              .substring(entity.offset, entity.offset + entity.length)
              .toLowerCase();
            return mentionText === `@${botUsername}`;
          }
          return false;
        });
        if (isBotMentioned && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Store chat metadata for discovery
      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        chatName,
        'telegram',
        isGroup,
      );

      // Only deliver full message for registered groups
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) {
        logger.debug(
          { chatJid, chatName },
          'Message from unregistered Telegram chat',
        );
        return;
      }

      // Extract forward metadata
      let forwarded_from: string | undefined;
      const fwd = ctx.message.forward_origin;
      if (fwd) {
        if (fwd.type === 'user') forwarded_from = fwd.sender_user.first_name;
        else if (fwd.type === 'hidden_user')
          forwarded_from = fwd.sender_user_name || '(hidden)';
        else if (fwd.type === 'chat')
          forwarded_from = (fwd as any).sender_chat.title;
        else if (fwd.type === 'channel')
          forwarded_from = (fwd as any).chat.title;
      }

      // Extract reply-to metadata
      let reply_to_text: string | undefined;
      let reply_to_sender: string | undefined;
      const reply = ctx.message.reply_to_message;
      if (reply) {
        reply_to_sender = reply.from?.first_name;
        const rText = reply.text || reply.caption;
        if (rText) reply_to_text = rText.slice(0, 100);
      }

      // Deliver message — startMessageLoop() will pick it up
      this.opts.onMessage(chatJid, {
        id: msgId,
        chat_jid: chatJid,
        sender,
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: false,
        forwarded_from,
        reply_to_text,
        reply_to_sender,
      });

      logger.info(
        { chatJid, chatName, sender: senderName },
        'Telegram message stored',
      );
    });

    // Build downloader closure for telegram file downloads.
    const token = this.botToken;
    const bot = this.bot!;
    const tgDownload: AttachmentDownloader = async (a, maxBytes) => {
      if (a.source.kind !== 'telegram') {
        throw new Error('wrong source kind');
      }
      const file = await bot.api.getFile(a.source.fileId);
      if (!file.file_path) throw new Error('no file_path from telegram');
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`tg fetch HTTP ${res.status}`);
      const contentLength = parseInt(
        res.headers.get('content-length') || '0',
        10,
      );
      if (contentLength > maxBytes) {
        throw new Error(`file too large: ${contentLength} > ${maxBytes}`);
      }
      return Buffer.from(await res.arrayBuffer());
    };

    // Dispatch a non-text message with attachment metadata.
    const storeMedia = (
      ctx: any,
      placeholder: string,
      attachments: RawAttachment[],
    ) => {
      const chatJid = `tg:${ctx.chat.id}`;
      const group = this.opts.registeredGroups()[chatJid];
      if (!group) return;

      const timestamp = new Date(ctx.message.date * 1000).toISOString();
      const senderName =
        ctx.from?.first_name ||
        ctx.from?.username ||
        ctx.from?.id?.toString() ||
        'Unknown';
      const caption = ctx.message.caption ? ` ${ctx.message.caption}` : '';

      const isGroup =
        ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      this.opts.onChatMetadata(
        chatJid,
        timestamp,
        undefined,
        'telegram',
        isGroup,
      );
      // Extract forward metadata
      let forwarded_from: string | undefined;
      const fwd = ctx.message.forward_origin;
      if (fwd) {
        if (fwd.type === 'user') forwarded_from = fwd.sender_user.first_name;
        else if (fwd.type === 'hidden_user')
          forwarded_from = fwd.sender_user_name || '(hidden)';
        else if (fwd.type === 'chat')
          forwarded_from = (fwd as any).sender_chat.title;
        else if (fwd.type === 'channel')
          forwarded_from = (fwd as any).chat.title;
      }

      // Extract reply-to metadata
      let reply_to_text: string | undefined;
      let reply_to_sender: string | undefined;
      const reply = ctx.message.reply_to_message;
      if (reply) {
        reply_to_sender = reply.from?.first_name;
        const rText = reply.text || reply.caption;
        if (rText) reply_to_text = rText.slice(0, 100);
      }

      this.opts.onMessage(
        chatJid,
        {
          id: ctx.message.message_id.toString(),
          chat_jid: chatJid,
          sender: ctx.from?.id?.toString() || '',
          sender_name: senderName,
          content: `${placeholder}${caption}`,
          timestamp,
          is_from_me: false,
          forwarded_from,
          reply_to_text,
          reply_to_sender,
        },
        attachments.length > 0 ? attachments : undefined,
        attachments.length > 0 ? tgDownload : undefined,
      );
    };

    this.bot.on('message:photo', (ctx) => {
      const photos = ctx.message.photo || [];
      const best = photos[photos.length - 1];
      const atts: RawAttachment[] = best
        ? [
            {
              type: 'image' as AttachmentType,
              mimeType: 'image/jpeg',
              sizeBytes: best.file_size,
              source: { kind: 'telegram', fileId: best.file_id },
            },
          ]
        : [];
      storeMedia(ctx, '[Photo]', atts);
    });

    this.bot.on('message:video', (ctx) => {
      const v = ctx.message.video;
      const atts: RawAttachment[] = v
        ? [
            {
              type: 'video' as AttachmentType,
              mimeType: v.mime_type || 'video/mp4',
              filename: v.file_name,
              sizeBytes: v.file_size,
              durationSeconds: v.duration,
              source: { kind: 'telegram', fileId: v.file_id },
            },
          ]
        : [];
      storeMedia(ctx, '[Video]', atts);
    });

    this.bot.on('message:voice', (ctx) => {
      const v = ctx.message.voice;
      const atts: RawAttachment[] = v
        ? [
            {
              type: 'voice' as AttachmentType,
              mimeType: v.mime_type || 'audio/ogg',
              sizeBytes: v.file_size,
              durationSeconds: v.duration,
              source: { kind: 'telegram', fileId: v.file_id },
            },
          ]
        : [];
      storeMedia(ctx, '[Voice message]', atts);
    });

    this.bot.on('message:audio', (ctx) => {
      const a = ctx.message.audio;
      const atts: RawAttachment[] = a
        ? [
            {
              type: 'audio' as AttachmentType,
              mimeType: a.mime_type || 'audio/mpeg',
              filename: a.file_name,
              sizeBytes: a.file_size,
              durationSeconds: a.duration,
              source: { kind: 'telegram', fileId: a.file_id },
            },
          ]
        : [];
      storeMedia(ctx, '[Audio]', atts);
    });

    this.bot.on('message:document', (ctx) => {
      const d = ctx.message.document;
      const name = d?.file_name || 'file';
      const atts: RawAttachment[] = d
        ? [
            {
              type: 'document' as AttachmentType,
              mimeType: d.mime_type,
              filename: d.file_name,
              sizeBytes: d.file_size,
              source: { kind: 'telegram', fileId: d.file_id },
            },
          ]
        : [];
      storeMedia(ctx, `[Document: ${name}]`, atts);
    });

    this.bot.on('message:sticker', (ctx) => {
      const s = ctx.message.sticker;
      const emoji = s?.emoji || '';
      const atts: RawAttachment[] = s
        ? [
            {
              type: 'sticker' as AttachmentType,
              mimeType: s.is_animated
                ? 'application/x-tgsticker'
                : 'image/webp',
              sizeBytes: s.file_size,
              source: { kind: 'telegram', fileId: s.file_id },
            },
          ]
        : [];
      storeMedia(ctx, `[Sticker ${emoji}]`, atts);
    });

    this.bot.on('message:location', (ctx) => storeMedia(ctx, '[Location]', []));
    this.bot.on('message:contact', (ctx) => storeMedia(ctx, '[Contact]', []));

    // Handle errors gracefully
    this.bot.catch((err) => {
      logger.error({ err: err.message }, 'Telegram bot error');
    });

    // Register slash commands in Telegram menu
    this.bot.api
      .setMyCommands([
        { command: 'new', description: 'Start a fresh session' },
        { command: 'ping', description: 'Check bot status' },
        { command: 'chatid', description: 'Show chat JID for registration' },
      ])
      .catch((err) =>
        logger.warn({ err }, 'Failed to set Telegram bot commands'),
      );

    // Start polling — returns a Promise that resolves when started
    return new Promise<void>((resolve) => {
      this.bot!.start({
        onStart: (botInfo) => {
          logger.info(
            { username: botInfo.username, id: botInfo.id },
            'Telegram bot connected',
          );
          console.log(`\n  Telegram bot: @${botInfo.username}`);
          console.log(
            `  Send /chatid to the bot to get a chat's registration ID\n`,
          );
          resolve();
        },
      });
    });
  }

  async sendMessage(
    jid: string,
    text: string,
    _opts?: SendOpts,
  ): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');

      // Telegram has a 4096 character limit per message — split if needed
      const html = mdToHtml(text);
      const MAX_LENGTH = 4096;
      for (let i = 0; i < html.length; i += MAX_LENGTH) {
        const chunk = html.slice(i, i + MAX_LENGTH);
        try {
          await this.bot.api.sendMessage(numericId, chunk, {
            parse_mode: 'HTML',
          });
        } catch (htmlErr: any) {
          // Telegram rejects malformed HTML (e.g. underscore inside <code> treated
          // as italic, causing unmatched tags). Retry as plain text.
          if (htmlErr?.error_code === 400) {
            logger.warn(
              { jid, error: htmlErr.description },
              'HTML parse failed, retrying as plain text',
            );
            await this.bot.api.sendMessage(
              numericId,
              text.slice(i, i + MAX_LENGTH),
            );
          } else {
            throw htmlErr;
          }
        }
      }
      logger.info({ jid, length: text.length }, 'Telegram message sent');
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message');
    }
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('tg:');
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop();
      this.bot = null;
      logger.info('Telegram bot stopped');
    }
  }

  async sendDocument(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return;
    }
    try {
      const numericId = jid.replace(/^tg:/, '');
      const name = filename ?? path.basename(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const input = new InputFile(fs.createReadStream(filePath), name);
      if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        await this.bot.api.sendPhoto(numericId, input);
      } else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) {
        await this.bot.api.sendVideo(numericId, input);
      } else if (ext === 'gif') {
        await this.bot.api.sendAnimation(numericId, input);
      } else if (['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(ext)) {
        await this.bot.api.sendAudio(numericId, input);
      } else {
        await this.bot.api.sendDocument(numericId, input);
      }
      logger.info({ jid, filePath, name }, 'Telegram media sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send Telegram document');
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!this.bot || !isTyping) return;
    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.sendChatAction(numericId, 'typing');
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to send Telegram typing indicator');
    }
  }
}
