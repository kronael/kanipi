import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { TwitterClient, TwitterConfig, createClient } from './client.js';
import { TwitterWatcher } from './watcher.js';

export class TwitterChannel implements Channel {
  readonly name = 'twitter';
  private client: TwitterClient | null = null;
  private watcher: TwitterWatcher | null = null;

  constructor(
    private config: TwitterConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = createClient(this.config);
    const me = await this.client.verifyCredentials();
    logger.info({ user: me.username }, 'twitter: connected');
    registerClient('twitter', this.client);
    this.watcher = new TwitterWatcher(this.client, this.opts.onMessage);
    await this.watcher.start();
  }

  async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    unregisterClient('twitter');
    this.client = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('twitter:');
  }

  async sendMessage(jid: string, text: string, opts?: SendOpts): Promise<void> {
    if (!this.client) throw new Error('twitter not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
    void jid;
  }
}

export { TwitterClient, TwitterConfig, createClient } from './client.js';
