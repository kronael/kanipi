import { registerClient, unregisterClient } from '../../actions/social.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { RedditClient, RedditConfig } from './client.js';
import { RedditWatcher } from './watcher.js';

export class RedditChannel implements Channel {
  readonly name = 'reddit';
  private client: RedditClient | null = null;
  private watcher: RedditWatcher | null = null;

  constructor(
    private config: RedditConfig,
    private opts: ChannelOpts,
    private subreddits: string[] = [],
  ) {}

  async connect(): Promise<void> {
    this.client = new RedditClient(this.config);
    await this.client.authenticate();
    registerClient('reddit', this.client);
    this.watcher = new RedditWatcher({
      client: this.client,
      subreddits: this.subreddits,
      onMessage: (msg) => this.opts.onMessage(msg.chat_jid, msg),
    });
    this.watcher.start();
  }

  async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    unregisterClient('reddit');
    this.client = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('reddit:');
  }

  async sendMessage(jid: string, text: string, opts?: SendOpts): Promise<void> {
    if (!this.client) throw new Error('reddit not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      // post to subreddit extracted from jid
      const target = jid.replace(/^reddit:/, '');
      await this.client.post(text);
      void target;
    }
  }
}

export { RedditClient, RedditConfig } from './client.js';
export { RedditWatcher } from './watcher.js';
