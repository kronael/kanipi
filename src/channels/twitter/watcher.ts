import type { TweetV2SingleStreamResult } from 'twitter-api-v2';

import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { TwitterClient } from './client.js';

const log = logger.child({ channel: 'twitter' });
const POLL_MS = 30_000;

export class TwitterWatcher {
  private running = false;
  private sinceId: string | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private client: TwitterClient,
    private onMsg: OnInboundMessage,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    if (await this.tryStream()) return;
    log.info('streaming unavailable, falling back to polling');
    this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async tryStream(): Promise<boolean> {
    try {
      const stream = await this.client.api.v2.searchStream({
        'tweet.fields': ['author_id', 'created_at', 'in_reply_to_user_id'],
        'user.fields': ['username'],
        expansions: ['author_id'],
      });
      stream.autoReconnect = true;
      stream.on('data', (t: TweetV2SingleStreamResult) => {
        this.handleTweet(t);
      });
      stream.on('error', (err: Error) => {
        log.error({ err }, 'stream error');
      });
      stream.on('reconnect', () => {
        log.info('stream reconnecting');
      });
      return true;
    } catch {
      return false;
    }
  }

  private poll(): void {
    if (!this.running) return;
    this.fetchMentions()
      .catch((err) => log.error({ err }, 'poll error'))
      .finally(() => {
        if (this.running) {
          this.timer = setTimeout(() => this.poll(), POLL_MS);
        }
      });
  }

  private async fetchMentions(): Promise<void> {
    const uid = this.client.userId;
    if (!uid) return;
    const r = await this.client.api.v2.userMentionTimeline(uid, {
      since_id: this.sinceId,
      'tweet.fields': ['author_id', 'created_at', 'in_reply_to_user_id'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });
    const tweets = r.data?.data ?? [];
    const users = new Map(
      (r.data?.includes?.users ?? []).map((u) => [u.id, u.username]),
    );
    for (const t of tweets) {
      const msg = this.toMessage(
        t.id,
        t.text,
        t.author_id,
        t.created_at,
        users,
      );
      this.onMsg(msg.chat_jid, msg);
    }
    if (tweets.length > 0) this.sinceId = tweets[0].id;
  }

  private handleTweet(result: TweetV2SingleStreamResult): void {
    const t = result.data;
    const users = new Map(
      (result.includes?.users ?? []).map((u) => [u.id, u.username]),
    );
    const msg = this.toMessage(t.id, t.text, t.author_id, t.created_at, users);
    this.onMsg(msg.chat_jid, msg);
  }

  private toMessage(
    id: string,
    text: string,
    authorId?: string,
    createdAt?: string,
    users?: Map<string, string>,
  ): NewMessage {
    const handle = (authorId && users?.get(authorId)) ?? authorId ?? 'unknown';
    return {
      id,
      chat_jid: `twitter:${authorId ?? 'unknown'}`,
      sender: handle,
      sender_name: handle,
      content: text,
      timestamp: createdAt ?? new Date().toISOString(),
      platform: Platform.Twitter,
      verb: Verb.Message,
    };
  }
}
