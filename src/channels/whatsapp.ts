import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import makeWASocket, {
  Browsers,
  DisconnectReason,
  WAMessage,
  WASocket,
  downloadMediaMessage,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';

import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  STORE_DIR,
} from '../config.js';
import {
  AttachmentDownloader,
  AttachmentType,
  RawAttachment,
  WhatsAppSource,
  mimeFromFile,
} from '../mime.js';
import { getLastGroupSync, setLastGroupSync, updateChatName } from '../db.js';
import { logger } from '../logger.js';
import { Channel, ChannelOpts, Platform, SendOpts, Verb } from '../types.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Strip @lid suffix only — @g.us and @s.whatsapp.net are kept per spec
function stripLidSuffix(jid: string): string {
  return jid.replace(/@lid$/, '');
}

/** Convert markdown formatting to WhatsApp formatting */
function markdownToWhatsApp(text: string): string {
  return (
    text
      // **bold** or __bold__ → *bold*
      .replace(/\*\*(.+?)\*\*/g, '*$1*')
      .replace(/__(.+?)__/g, '*$1*')
      // ~~strikethrough~~ → ~strikethrough~
      .replace(/~~(.+?)~~/g, '~$1~')
  );
}

export class WhatsAppChannel implements Channel {
  name = 'whatsapp';

  private sock!: WASocket;
  private connected = false;
  private lidToPhoneMap: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private groupSyncTimerStarted = false;

  private opts: ChannelOpts;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  private toWaJid(jid: string): string {
    const bare = jid.replace(/^whatsapp:/, '');
    if (bare.includes('@')) return bare;
    return `${bare}@s.whatsapp.net`;
  }

  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.connectInternal(resolve).catch(reject);
    });
  }

  private async connectInternal(onFirstOpen?: () => void): Promise<void> {
    const authDir = path.join(STORE_DIR, 'auth');
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestWaWebVersion({}).catch((err) => {
      logger.warn(
        { err },
        'Failed to fetch latest WA Web version, using default',
      );
      return { version: undefined };
    });
    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'),
    });

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const msg =
          'WhatsApp authentication required. Run /setup in Claude Code.';
        logger.error(msg);
        exec(
          `osascript -e 'display notification "${msg}" with title "NanoClaw" sound name "Basso"'`,
        );
        setTimeout(() => process.exit(1), 1000);
      }

      if (connection === 'close') {
        this.connected = false;
        const reason = (
          lastDisconnect?.error as { output?: { statusCode?: number } }
        )?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        logger.info(
          {
            reason,
            shouldReconnect,
            queuedMessages: this.outgoingQueue.length,
          },
          'Connection closed',
        );

        if (shouldReconnect) {
          logger.info('Reconnecting...');
          this.connectInternal().catch((err) => {
            logger.error({ err }, 'Failed to reconnect, retrying in 5s');
            setTimeout(() => {
              this.connectInternal().catch((err2) => {
                logger.error({ err: err2 }, 'Reconnection retry failed');
              });
            }, 5000);
          });
        } else {
          logger.info('Logged out. Run /setup to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        this.connected = true;
        logger.info('Connected to WhatsApp');

        // Set unavailable so WhatsApp doesn't suppress phone notifications
        this.sock.sendPresenceUpdate('unavailable').catch((err) => {
          logger.warn({ err }, 'Failed to send presence update');
        });

        // Build LID to phone mapping from auth state for self-chat translation
        if (this.sock.user) {
          const phoneUser = this.sock.user.id.split(':')[0];
          const lidUser = this.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            this.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
            logger.debug({ lidUser, phoneUser }, 'LID to phone mapping set');
          }
        }

        // Flush any messages queued while disconnected
        this.flushOutgoingQueue().catch((err) =>
          logger.error({ err }, 'Failed to flush outgoing queue'),
        );

        // Sync group metadata on startup (respects 24h cache)
        this.syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Initial group sync failed'),
        );
        // Set up daily sync timer (only once)
        if (!this.groupSyncTimerStarted) {
          this.groupSyncTimerStarted = true;
          setInterval(() => {
            this.syncGroupMetadata().catch((err) =>
              logger.error({ err }, 'Periodic group sync failed'),
            );
          }, GROUP_SYNC_INTERVAL_MS);
        }

        // Signal first connection to caller
        if (onFirstOpen) {
          onFirstOpen();
          onFirstOpen = undefined;
        }
      }
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;

        // Translate LID JID to phone JID if applicable
        const translated = await this.translateJid(rawJid);
        const isGroup = translated.endsWith('@g.us');
        const chatJid = `whatsapp:${stripLidSuffix(translated)}`;

        const timestamp = new Date(
          Number(msg.messageTimestamp) * 1000,
        ).toISOString();
        this.opts.onChatMetadata(
          chatJid,
          timestamp,
          undefined,
          'whatsapp',
          isGroup,
        );

        // /chatid works from any chat (before group check)
        const msgText =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          '';
        if (msgText.trim() === '/chatid') {
          await this.sock?.sendMessage(rawJid, {
            text: `Chat JID: ${chatJid}`,
          });
          continue;
        }

        // Only deliver full message for registered groups
        if (this.opts.isRoutedJid(chatJid)) {
          const m = msg.message;
          const content =
            m?.conversation ||
            m?.extendedTextMessage?.text ||
            m?.imageMessage?.caption ||
            m?.videoMessage?.caption ||
            '';

          // Build raw attachment list from media message types
          const attachments: RawAttachment[] = [];
          const source: WhatsAppSource = {
            kind: 'whatsapp',
            message: msg as unknown as Record<string, unknown>,
          };
          if (m?.imageMessage) {
            attachments.push({
              type: 'image' as AttachmentType,
              mimeType: m.imageMessage.mimetype || 'image/jpeg',
              sizeBytes: m.imageMessage.fileLength
                ? Number(m.imageMessage.fileLength)
                : undefined,
              source,
            });
          } else if (m?.videoMessage) {
            attachments.push({
              type: 'video' as AttachmentType,
              mimeType: m.videoMessage.mimetype || 'video/mp4',
              sizeBytes: m.videoMessage.fileLength
                ? Number(m.videoMessage.fileLength)
                : undefined,
              durationSeconds: m.videoMessage.seconds ?? undefined,
              source,
            });
          } else if (m?.audioMessage) {
            const isPtt = m.audioMessage.ptt;
            attachments.push({
              type: isPtt
                ? ('voice' as AttachmentType)
                : ('audio' as AttachmentType),
              mimeType: m.audioMessage.mimetype || 'audio/ogg',
              sizeBytes: m.audioMessage.fileLength
                ? Number(m.audioMessage.fileLength)
                : undefined,
              durationSeconds: m.audioMessage.seconds ?? undefined,
              source,
            });
          } else if (m?.documentMessage) {
            attachments.push({
              type: 'document' as AttachmentType,
              mimeType: m.documentMessage.mimetype ?? undefined,
              filename: m.documentMessage.fileName ?? undefined,
              sizeBytes: m.documentMessage.fileLength
                ? Number(m.documentMessage.fileLength)
                : undefined,
              source,
            });
          } else if (m?.stickerMessage) {
            attachments.push({
              type: 'sticker' as AttachmentType,
              mimeType: m.stickerMessage.mimetype || 'image/webp',
              source,
            });
          }

          // Skip protocol messages with no text and no media
          if (!content && attachments.length === 0) continue;

          const rawSender = msg.key.participant || msg.key.remoteJid || '';
          const senderName = msg.pushName || rawSender.split('@')[0];
          const sender = `whatsapp:${rawSender}`;

          const fromMe = msg.key.fromMe || false;
          // Detect bot messages: with own number, fromMe is reliable
          // since only the bot sends from that number.
          // With shared number, bot messages carry the assistant name prefix
          // (even in DMs/self-chat) so we check for that.
          const isBotMessage = ASSISTANT_HAS_OWN_NUMBER
            ? fromMe
            : content.startsWith(`${ASSISTANT_NAME}:`);

          // Build a downloader that uses baileys downloadMediaMessage.
          const waDownload: AttachmentDownloader = async (a, maxBytes) => {
            if (a.source.kind !== 'whatsapp') {
              throw new Error('wrong source kind');
            }
            const waMsg = a.source.message as unknown as WAMessage;
            const stream = await downloadMediaMessage(waMsg, 'buffer', {});
            const buf = stream as Buffer;
            if (buf.length > maxBytes) {
              throw new Error(`file too large: ${buf.length} > ${maxBytes}`);
            }
            return buf;
          };

          // Extract forward/reply metadata from contextInfo
          const ctxInfo =
            m.extendedTextMessage?.contextInfo ||
            m.imageMessage?.contextInfo ||
            m.videoMessage?.contextInfo ||
            m.audioMessage?.contextInfo ||
            m.documentMessage?.contextInfo;
          let forwarded_from: string | undefined;
          let reply_to_text: string | undefined;
          let reply_to_sender: string | undefined;
          const reply_to_id = ctxInfo?.stanzaId ?? undefined;
          if (ctxInfo?.isForwarded) {
            forwarded_from = '(forwarded)';
          }
          if (ctxInfo?.quotedMessage) {
            const qText =
              ctxInfo.quotedMessage.conversation ||
              ctxInfo.quotedMessage.extendedTextMessage?.text;
            if (qText) reply_to_text = qText.slice(0, 100);
            if (ctxInfo.participant)
              reply_to_sender = ctxInfo.participant.split('@')[0];
          }

          this.opts.onMessage(
            chatJid,
            {
              id: msg.key.id || '',
              chat_jid: chatJid,
              sender,
              sender_name: senderName,
              content: content || `[${attachments[0]?.type || 'media'}]`,
              timestamp,
              is_from_me: fromMe,
              is_bot_message: isBotMessage,
              forwarded_from,
              reply_to_text,
              reply_to_sender,
              reply_to_id,
              verb: Verb.Message,
              platform: Platform.WhatsApp,
            },
            attachments.length > 0 ? attachments : undefined,
            attachments.length > 0 ? waDownload : undefined,
          );

          // Mark message as read (blue ticks)
          if (!fromMe && msg.key) {
            this.sock.readMessages([msg.key]).catch((err) => {
              logger.debug({ err, msgId: msg.key.id }, 'read receipt failed');
            });
          }
        }
      }
    });
  }

  async sendMessage(
    jid: string,
    text: string,
    _opts?: SendOpts,
  ): Promise<void> {
    // Convert markdown to WhatsApp formatting
    const formatted = markdownToWhatsApp(text);
    // Prefix bot messages with assistant name so users know who's speaking.
    // On a shared number, prefix is also needed in DMs (including self-chat)
    // to distinguish bot output from user messages.
    // Skip only when the assistant has its own dedicated phone number.
    const prefixed = ASSISTANT_HAS_OWN_NUMBER
      ? formatted
      : `${ASSISTANT_NAME}: ${formatted}`;

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.info(
        { jid, length: prefixed.length, queueSize: this.outgoingQueue.length },
        'WA disconnected, message queued',
      );
      return;
    }
    try {
      await this.sock.sendMessage(this.toWaJid(jid), { text: prefixed });
      logger.info({ jid, length: prefixed.length }, 'Message sent');
    } catch (err) {
      // If send fails, queue it for retry on reconnect
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send, message queued',
      );
    }
  }

  async sendDocument(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void> {
    if (!this.connected) {
      logger.warn({ jid }, 'WA disconnected, cannot send document');
      return;
    }
    try {
      const bare = this.toWaJid(jid);
      const name = filename ?? path.basename(filePath);
      const mimetype = await mimeFromFile(filePath);
      const buf = fs.readFileSync(filePath);
      if (mimetype.startsWith('image/')) {
        await this.sock.sendMessage(bare, {
          image: buf,
          caption: name,
          mimetype,
        });
      } else if (mimetype.startsWith('video/')) {
        await this.sock.sendMessage(bare, {
          video: buf,
          caption: name,
          mimetype,
        });
      } else if (mimetype.startsWith('audio/')) {
        await this.sock.sendMessage(bare, {
          audio: buf,
          mimetype,
          ptt: false,
        });
      } else {
        await this.sock.sendMessage(bare, {
          document: buf,
          fileName: name,
          mimetype,
        });
      }
      logger.info({ jid, filePath, name }, 'WA media sent');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to send WA media');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('whatsapp:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sock?.end(undefined);
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    try {
      const status = isTyping ? 'composing' : 'paused';
      logger.debug({ jid, status }, 'Sending presence update');
      await this.sock.sendPresenceUpdate(status, this.toWaJid(jid));
    } catch (err) {
      logger.debug({ jid, err }, 'Failed to update typing status');
    }
  }

  /**
   * Sync group metadata from WhatsApp.
   * Fetches all participating groups and stores their names in the database.
   * Called on startup, daily, and on-demand via IPC.
   */
  async syncGroupMetadata(force = false): Promise<void> {
    if (!force) {
      const lastSync = getLastGroupSync();
      if (lastSync) {
        const lastSyncTime = new Date(lastSync).getTime();
        if (Date.now() - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
          logger.debug({ lastSync }, 'Skipping group sync - synced recently');
          return;
        }
      }
    }

    try {
      logger.info('Syncing group metadata from WhatsApp...');
      const groups = await this.sock.groupFetchAllParticipating();

      let count = 0;
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          updateChatName(`whatsapp:${jid}`, metadata.subject);
          count++;
        }
      }

      setLastGroupSync();
      logger.info({ count }, 'Group metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync group metadata');
    }
  }

  private async translateJid(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;
    const lidUser = jid.split('@')[0].split(':')[0];

    // Check local cache first
    const cached = this.lidToPhoneMap[lidUser];
    if (cached) {
      logger.debug(
        { lidJid: jid, phoneJid: cached },
        'Translated LID to phone JID (cached)',
      );
      return cached;
    }

    // Query Baileys' signal repository for the mapping
    try {
      const pn = await this.sock.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) {
        const phoneJid = `${pn.split('@')[0].split(':')[0]}@s.whatsapp.net`;
        this.lidToPhoneMap[lidUser] = phoneJid;
        logger.info(
          { lidJid: jid, phoneJid },
          'Translated LID to phone JID (signalRepository)',
        );
        return phoneJid;
      }
    } catch (err) {
      logger.debug({ err, jid }, 'Failed to resolve LID via signalRepository');
    }

    return jid;
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing outgoing message queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        // Send directly — queued items are already prefixed by sendMessage
        await this.sock.sendMessage(this.toWaJid(item.jid), {
          text: item.text,
        });
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}
