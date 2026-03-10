import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { FacebookConfig } from './client.js';

const log = logger.child({ channel: 'facebook' });
const POLL_MS = 30_000;

export class FacebookWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private lastTs = '';
  private base: string;
  private token: string;
  private pageId: string;

  constructor(
    config: FacebookConfig,
    private onMsg: OnInboundMessage,
  ) {
    const v = config.graphApiVersion ?? 'v21.0';
    this.base = `https://graph.facebook.com/${v}`;
    this.token = config.pageAccessToken;
    this.pageId = config.pageId;
  }

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
      const fields = 'id,message,from,created_time';
      const url =
        `${this.base}/${this.pageId}/feed` +
        `?fields=${fields}&limit=10&access_token=${this.token}`;
      const res = await fetch(url);
      if (!res.ok) {
        log.warn({ status: res.status }, 'feed fetch failed');
      } else {
        const data = (await res.json()) as {
          data: Array<{
            id: string;
            message?: string;
            from?: { id: string; name: string };
            created_time: string;
          }>;
        };
        for (const p of data.data) {
          if (!p.message || !p.from) continue;
          if (p.from.id === this.pageId) continue;
          if (this.lastTs && p.created_time <= this.lastTs) continue;

          const msg: NewMessage = {
            id: p.id,
            chat_jid: `facebook:${this.pageId}`,
            sender: p.from.id,
            sender_name: p.from.name,
            content: p.message,
            timestamp: p.created_time,
            verb: Verb.Message,
            platform: Platform.Facebook,
          };
          this.onMsg(msg.chat_jid, msg);
        }
        if (data.data.length > 0) {
          this.lastTs = data.data[0].created_time;
        }
      }
    } catch (err) {
      log.warn({ err }, 'poll error');
    }
    if (!this.closed) {
      this.timer = setTimeout(() => this.poll(), POLL_MS);
    }
  }
}
