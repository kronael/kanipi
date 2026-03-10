import { logger } from '../../logger.js';
import { ChannelOpts, NewMessage, Verb, Platform } from '../../types.js';
import { FacebookConfig } from './client.js';

export class FacebookWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTs = '';
  private base: string;
  private token: string;
  private pageId: string;

  constructor(
    private config: FacebookConfig,
    private opts: ChannelOpts,
  ) {
    const v = config.graphApiVersion ?? 'v21.0';
    this.base = `https://graph.facebook.com/${v}`;
    this.token = config.pageAccessToken;
    this.pageId = config.pageId;
  }

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const fields = 'id,message,from,created_time';
      const url =
        `${this.base}/${this.pageId}/feed` +
        `?fields=${fields}&limit=10&access_token=${this.token}`;
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn({ status: res.status }, 'facebook feed fetch failed');
        return;
      }
      const data = (await res.json()) as {
        data: Array<{
          id: string;
          message?: string;
          from?: { id: string; name: string };
          created_time: string;
        }>;
      };
      for (const post of data.data) {
        if (!post.message || !post.from) continue;
        if (post.from.id === this.pageId) continue; // skip own posts
        if (this.lastTs && post.created_time <= this.lastTs) continue;

        const msg: NewMessage = {
          id: `fb-${post.id}`,
          chat_jid: `facebook:${this.pageId}`,
          sender: post.from.id,
          sender_name: post.from.name,
          content: post.message,
          timestamp: post.created_time,
          verb: Verb.Message,
          platform: Platform.Facebook,
        };
        this.opts.onMessage(`facebook:${this.pageId}`, msg);
      }
      if (data.data.length > 0) {
        this.lastTs = data.data[0].created_time;
      }
    } catch (err) {
      logger.warn({ err }, 'facebook poll error');
    }
  }
}
