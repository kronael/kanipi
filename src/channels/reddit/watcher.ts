import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { RedditClient } from './client.js';

const log = logger.child({ channel: 'reddit' });
const POLL_MS = 30_000;

interface RedditThing {
  kind: string;
  data: {
    name: string;
    author: string;
    body?: string;
    selftext?: string;
    title?: string;
    subreddit?: string;
    created_utc: number;
    id: string;
    parent_id?: string;
    link_id?: string;
  };
}

interface Listing {
  data: { children: RedditThing[] };
}

export class RedditWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private lastSeen = new Map<string, string>();

  constructor(
    private client: RedditClient,
    private onMsg: OnInboundMessage,
    private subreddits: string[] = [],
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
      await this.pollInbox();
      for (const sr of this.subreddits) {
        await this.pollSubreddit(sr);
      }
    } catch (err) {
      log.error({ err }, 'poll error');
    }
    if (!this.closed) {
      this.timer = setTimeout(() => this.poll(), POLL_MS);
    }
  }

  private async pollInbox(): Promise<void> {
    const before = this.lastSeen.get('inbox');
    const qs = before ? `?before=${before}` : '?limit=25';
    const listing = (await this.client.fetchJson(
      `/message/inbox.json${qs}`,
    )) as Listing;
    const items = listing.data.children;
    if (!items.length) return;
    this.lastSeen.set('inbox', items[0].data.name);
    if (!before) return;
    for (const item of items.reverse()) {
      const msg = this.toMessage(item, 'inbox');
      this.onMsg(msg.chat_jid, msg);
    }
  }

  private async pollSubreddit(sr: string): Promise<void> {
    const key = `sr:${sr}`;
    const before = this.lastSeen.get(key);
    const qs = before ? `?before=${before}` : '?limit=25';
    const listing = (await this.client.fetchJson(
      `/r/${sr}/new.json${qs}`,
    )) as Listing;
    const items = listing.data.children;
    if (!items.length) return;
    this.lastSeen.set(key, items[0].data.name);
    if (!before) return;
    for (const item of items.reverse()) {
      const msg = this.toMessage(item, sr);
      this.onMsg(msg.chat_jid, msg);
    }
  }

  private toMessage(thing: RedditThing, source: string): NewMessage {
    const d = thing.data;
    const content = d.body ?? d.selftext ?? d.title ?? '';
    const jid =
      source === 'inbox'
        ? `reddit:${d.author}`
        : `reddit:${d.subreddit ?? source}`;
    return {
      id: d.name,
      chat_jid: jid,
      sender: d.author,
      sender_name: d.author,
      content,
      timestamp: new Date(d.created_utc * 1000).toISOString(),
      platform: Platform.Reddit,
      verb: thing.kind === 't1' ? Verb.Reply : Verb.Post,
      parent: d.parent_id,
      root: d.link_id,
    };
  }
}
