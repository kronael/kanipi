import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { FacebookClient, FacebookConfig, createClient } from './client.js';
import { FacebookWatcher } from './watcher.js';

export class FacebookChannel implements Channel {
  readonly name = 'facebook';
  private client: FacebookClient | null = null;
  private watcher: FacebookWatcher | null = null;

  constructor(
    private config: FacebookConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = createClient(this.config);
    registerClient('facebook', this.client);
    logger.info({ pageId: this.config.pageId }, 'facebook: connected');
    this.watcher = new FacebookWatcher(this.config, this.opts);
    this.watcher.start();
    this.opts.onChatMetadata(
      `facebook:${this.config.pageId}`,
      new Date().toISOString(),
      'Facebook Page',
      'facebook',
      true,
    );
  }

  async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    unregisterClient('facebook');
    this.client = null;
    logger.info('facebook disconnected');
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('facebook:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('facebook not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
  }
}

export { FacebookClient, FacebookConfig, createClient } from './client.js';
