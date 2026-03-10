import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { RedditClient, RedditConfig } from './client.js';
import { RedditWatcher } from './watcher.js';

const log = logger.child({ channel: 'reddit' });

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

    this.opts.onChatMetadata(
      `reddit:${this.config.username}`,
      new Date().toISOString(),
      this.config.username,
      'reddit',
    );

    this.watcher = new RedditWatcher(
      this.client,
      this.opts.onMessage,
      this.subreddits,
    );
    this.watcher.start();
    log.info({ user: this.config.username }, 'connected');
  }

  async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    unregisterClient('reddit');
    this.client = null;
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('reddit:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('reddit not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
  }
}

export { RedditClient, RedditConfig } from './client.js';
export { RedditWatcher } from './watcher.js';
