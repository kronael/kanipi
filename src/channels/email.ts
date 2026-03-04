import crypto from 'crypto';

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

import {
  EMAIL_ACCOUNT,
  EMAIL_IMAP_HOST,
  EMAIL_PASSWORD,
  EMAIL_SMTP_HOST,
} from '../config.js';
import {
  getEmailThread,
  getEmailThreadByMsgId,
  storeEmailThread,
} from '../db.js';
import { logger } from '../logger.js';
import { Channel, ChannelOpts } from '../types.js';

function threadId(rootMsgId: string): string {
  return crypto
    .createHash('sha256')
    .update(rootMsgId)
    .digest('hex')
    .slice(0, 12);
}

export class EmailChannel implements Channel {
  name = 'email';

  private opts: ChannelOpts;
  private imap: ImapFlow | null = null;
  private transport: nodemailer.Transporter | null = null;
  private connected = false;
  private stopped = false;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.transport = nodemailer.createTransport({
      host: EMAIL_SMTP_HOST,
      port: 587,
      secure: false,
      auth: { user: EMAIL_ACCOUNT, pass: EMAIL_PASSWORD },
    });
    this.connected = true;
    this.idleLoop().catch((err) => {
      logger.error({ err }, 'email idle loop exited unexpectedly');
    });
    logger.info({ account: EMAIL_ACCOUNT }, 'email channel connected');
  }

  private async idleLoop(): Promise<void> {
    let backoff = 1000;

    while (!this.stopped) {
      try {
        this.imap = new ImapFlow({
          host: EMAIL_IMAP_HOST,
          port: 993,
          secure: true,
          auth: { user: EMAIL_ACCOUNT, pass: EMAIL_PASSWORD },
          logger: false,
        });

        await this.imap.connect();
        await this.imap.mailboxOpen('INBOX');
        backoff = 1000;

        await this.fetchUnseen();

        while (!this.stopped) {
          await this.imap.idle();
          await this.fetchUnseen();
        }
      } catch (err) {
        if (this.stopped) break;
        logger.warn(
          { err, backoffMs: backoff },
          'email IMAP error, reconnecting',
        );
        try {
          await this.imap?.logout();
        } catch {}
        this.imap = null;
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  }

  private async fetchUnseen(): Promise<void> {
    if (!this.imap) return;

    const uids = await this.imap.search({ seen: false });
    if (!uids || uids.length === 0) return;

    for await (const msg of this.imap.fetch(
      { uid: uids as unknown as import('imapflow').SequenceString },
      { source: true, uid: true },
    )) {
      try {
        const rawSource: Buffer | undefined = msg.source;
        if (!rawSource) continue;
        const parsed = await simpleParser(rawSource);
        const rawMsgId = (parsed.messageId || '').replace(/^<|>$/g, '');
        if (!rawMsgId) continue;

        if (getEmailThreadByMsgId(rawMsgId)) {
          await this.imap.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], {
            uid: true,
          });
          continue;
        }

        const inReplyTo = ((parsed.inReplyTo as string) || '').replace(
          /^<|>$/g,
          '',
        );
        const parent = inReplyTo ? getEmailThreadByMsgId(inReplyTo) : null;
        const rootMsgId = parent?.root_msg_id ?? rawMsgId;
        const tid = parent?.thread_id ?? threadId(rootMsgId);

        const fromObj = parsed.from?.value?.[0];
        const fromAddress = fromObj?.address || '';
        const fromName = fromObj?.name || fromAddress;

        storeEmailThread(rawMsgId, tid, fromAddress, rootMsgId);

        const chatJid = `email:${tid}`;
        const timestamp = (parsed.date || new Date()).toISOString();
        const msgId = `email-${rawMsgId}`;

        const toAddrs = (parsed.to as { text: string } | undefined)?.text || '';
        const ccAddrs = (parsed.cc as { text: string } | undefined)?.text || '';
        const subject = parsed.subject || '(no subject)';
        const dateStr = parsed.date?.toUTCString() || timestamp;

        let headers = `From: ${fromName} <${fromAddress}>\nSubject: ${subject}\nDate: ${dateStr}\nTo: ${toAddrs}`;
        if (ccAddrs) headers += `\nCC: ${ccAddrs}`;

        const body = parsed.text || '';
        const content = `${headers}\n\n${body}`.trim();

        this.opts.onChatMetadata(chatJid, timestamp, fromName, 'email', false);

        const hasMainGroup = Object.values(this.opts.registeredGroups()).some(
          (g) => g.requiresTrigger === false,
        );
        if (!hasMainGroup) {
          logger.warn('email: no main group registered, dropping message');
          await this.imap.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], {
            uid: true,
          });
          continue;
        }

        this.opts.onMessage(chatJid, {
          id: msgId,
          chat_jid: chatJid,
          sender: `email:${fromAddress}`,
          sender_name: fromName,
          content,
          timestamp,
          is_from_me: false,
        });

        await this.imap.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], {
          uid: true,
        });

        logger.info(
          { chatJid, from: fromAddress, subject },
          'email message stored',
        );
      } catch (err) {
        logger.error({ err }, 'email: failed to process message');
      }
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.transport) {
      logger.warn('email transport not initialized');
      return;
    }

    const tid = jid.replace(/^email:/, '');
    const thread = getEmailThread(tid);
    if (!thread) {
      logger.warn({ jid }, 'email: no thread found for jid, cannot reply');
      return;
    }

    try {
      await this.transport.sendMail({
        from: EMAIL_ACCOUNT,
        to: thread.from_address,
        subject: 'Re: (your message)',
        text,
        inReplyTo: `<${thread.root_msg_id}>`,
        references: `<${thread.root_msg_id}>`,
      });
      logger.info({ jid, to: thread.from_address }, 'email sent');
    } catch (err) {
      logger.error({ jid, err }, 'failed to send email');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('email:');
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    try {
      await this.imap?.logout();
    } catch {}
    this.imap = null;
    if (this.transport) {
      this.transport.close?.();
      this.transport = null;
    }
    logger.info('email channel stopped');
  }
}
