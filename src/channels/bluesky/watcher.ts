import { AtpAgent } from '@atproto/api';

import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';

const log = logger.child({ channel: 'bluesky' });
const POLL_MS = 10_000;

export class BlueskyWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private cursor: string | undefined;

  constructor(
    private agent: AtpAgent,
    private onMsg: OnInboundMessage,
  ) {}

  start(): void {
    this.closed = false;
    this.poll();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.closed) return;
    try {
      const res = await this.agent.listNotifications({
        reasons: ['reply', 'mention'],
        limit: 25,
        cursor: this.cursor,
      });
      const notifs = res.data.notifications;
      if (notifs.length > 0) {
        this.cursor = res.data.cursor;
        for (const n of notifs) {
          if (n.isRead) continue;
          this.handleNotif(n);
        }
        await this.agent.updateSeenNotifications();
      }
    } catch (e) {
      log.warn({ err: e }, 'notification poll failed');
    }
    if (!this.closed) {
      this.timer = setTimeout(() => this.poll(), POLL_MS);
    }
  }

  private handleNotif(n: {
    uri: string;
    reason: string;
    author: { did: string; handle: string; displayName?: string };
    record: Record<string, unknown>;
    indexedAt: string;
  }): void {
    const rec = n.record as {
      text?: string;
      reply?: { parent?: { uri: string }; root?: { uri: string } };
      createdAt?: string;
    };

    const verb = n.reason === 'reply' ? Verb.Reply : Verb.Message;
    const parentUri = rec.reply?.parent?.uri;

    const msg: NewMessage = {
      id: n.uri,
      chat_jid: `bluesky:${n.author.did}`,
      sender: n.author.did,
      sender_name: n.author.displayName || n.author.handle,
      content: rec.text ?? '',
      timestamp: rec.createdAt ?? n.indexedAt,
      verb,
      platform: Platform.Bluesky,
      replyTo: parentUri,
      root: rec.reply?.root?.uri,
      parent: parentUri,
    };

    this.onMsg(msg.chat_jid, msg);
  }
}
