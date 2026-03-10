import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { TwitterClient, TwitterConfig, createClient } from './client.js';
import { TwitterWatcher } from './watcher.js';

const log = logger.child({ channel: 'twitter' });

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
    registerClient('twitter', this.client);

    this.opts.onChatMetadata(
      `twitter:${me.id}`,
      new Date().toISOString(),
      me.username,
      'twitter',
    );

    this.watcher = new TwitterWatcher(this.client, this.opts.onMessage);
    await this.watcher.start();
    log.info({ user: me.username }, 'connected');
  }

  async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    unregisterClient('twitter');
    this.client = null;
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('twitter:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('twitter not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
  }
}

export { TwitterClient, TwitterConfig, createClient } from './client.js';
