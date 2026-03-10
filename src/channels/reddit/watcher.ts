import { logger } from '../../logger.js';
import { NewMessage, Platform, Verb } from '../../types.js';
import { RedditClient } from './client.js';

interface RedditThing {
  kind: string;
  data: {
    name: string; // fullname e.g. t1_abc, t3_xyz
    author: string;
    body?: string; // comments/messages
    selftext?: string; // posts
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

export interface WatcherOpts {
  client: RedditClient;
  subreddits: string[];
  pollIntervalMs?: number;
  onMessage: (msg: NewMessage) => void;
}

export class RedditWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSeen = new Map<string, string>(); // source -> fullname

  constructor(private opts: WatcherOpts) {}

  start(): void {
    const ms = this.opts.pollIntervalMs ?? 30_000;
    this.poll();
    this.timer = setInterval(() => this.poll(), ms);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      await this.pollInbox();
      for (const sr of this.opts.subreddits) {
        await this.pollSubreddit(sr);
      }
    } catch (err) {
      logger.error({ err }, 'reddit poll error');
    }
  }

  private async pollInbox(): Promise<void> {
    const before = this.lastSeen.get('inbox');
    const qs = before ? `?before=${before}` : '?limit=25';
    const listing = (await this.opts.client.fetchJson(
      `/message/inbox.json${qs}`,
    )) as Listing;
    const items = listing.data.children;
    if (!items.length) return;
    this.lastSeen.set('inbox', items[0].data.name);
    if (!before) return; // first poll — seed only
    for (const item of items.reverse()) {
      this.opts.onMessage(this.toMessage(item, 'inbox'));
    }
  }

  private async pollSubreddit(sr: string): Promise<void> {
    const key = `sr:${sr}`;
    const before = this.lastSeen.get(key);
    const qs = before ? `?before=${before}` : '?limit=25';
    const listing = (await this.opts.client.fetchJson(
      `/r/${sr}/new.json${qs}`,
    )) as Listing;
    const items = listing.data.children;
    if (!items.length) return;
    this.lastSeen.set(key, items[0].data.name);
    if (!before) return;
    for (const item of items.reverse()) {
      this.opts.onMessage(this.toMessage(item, sr));
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
      content,
      timestamp: new Date(d.created_utc * 1000).toISOString(),
      platform: Platform.Reddit,
      verb: thing.kind === 't1' ? Verb.Reply : Verb.Post,
      parent: d.parent_id,
      root: d.link_id,
    };
  }
}
