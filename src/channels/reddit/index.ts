import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { RedditClient, RedditConfig } from './client.js';
import { startWatcher } from './watcher.js';

const log = logger.child({ channel: 'reddit' });

export class RedditChannel implements Channel {
  readonly name = 'reddit';
  private client: RedditClient;
  private stopWatcher: (() => void) | null = null;

  constructor(
    private config: RedditConfig,
    private opts: ChannelOpts,
    private subreddits: string[] = [],
  ) {
    this.client = new RedditClient(config);
  }

  async connect(): Promise<void> {
    await this.client.authenticate();
    registerClient('reddit', this.client);

    this.opts.onChatMetadata(
      `reddit:${this.config.username}`,
      new Date().toISOString(),
      this.config.username,
      'reddit',
    );

    this.stopWatcher = startWatcher(
      this.client,
      this.opts.onMessage,
      this.subreddits,
    );
    log.info({ user: this.config.username }, 'connected');
  }

  async disconnect(): Promise<void> {
    this.stopWatcher?.();
    this.stopWatcher = null;
    unregisterClient('reddit');
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.stopWatcher !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('reddit:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string | undefined> {
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
    return undefined;
  }
}

export { RedditClient, RedditConfig } from './client.js';
