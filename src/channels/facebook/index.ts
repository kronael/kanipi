import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { FacebookClient, FacebookConfig, createClient } from './client.js';
import { startWatcher } from './watcher.js';

const log = logger.child({ channel: 'facebook' });

export class FacebookChannel implements Channel {
  readonly name = 'facebook';
  private client: FacebookClient;
  private stopWatcher: (() => void) | null = null;

  constructor(
    private config: FacebookConfig,
    private opts: ChannelOpts,
  ) {
    this.client = createClient(config);
  }

  async connect(): Promise<void> {
    registerClient('facebook', this.client);

    this.opts.onChatMetadata(
      `facebook:${this.config.pageId}`,
      new Date().toISOString(),
      'Facebook Page',
      'facebook',
      true,
    );

    this.stopWatcher = startWatcher(this.config, this.opts.onMessage);
    log.info({ pageId: this.config.pageId }, 'connected');
  }

  async disconnect(): Promise<void> {
    this.stopWatcher?.();
    this.stopWatcher = null;
    unregisterClient('facebook');
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.stopWatcher !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('facebook:');
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

export { FacebookClient, FacebookConfig, createClient } from './client.js';
