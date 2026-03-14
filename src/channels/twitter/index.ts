import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { TwitterClient, TwitterConfig, createClient } from './client.js';
import { startWatcher } from './watcher.js';

const log = logger.child({ channel: 'twitter' });

export class TwitterChannel implements Channel {
  readonly name = 'twitter';
  private client: TwitterClient;
  private stopWatcher: (() => void) | null = null;

  constructor(
    private config: TwitterConfig,
    private opts: ChannelOpts,
  ) {
    this.client = createClient(config);
  }

  async connect(): Promise<void> {
    const me = await this.client.verifyCredentials();
    registerClient('twitter', this.client);

    this.opts.onChatMetadata(
      `twitter:${me.id}`,
      new Date().toISOString(),
      me.username,
      'twitter',
    );

    this.stopWatcher = await startWatcher(this.client, this.opts.onMessage);
    log.info({ user: me.username }, 'connected');
  }

  async disconnect(): Promise<void> {
    this.stopWatcher?.();
    this.stopWatcher = null;
    unregisterClient('twitter');
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.stopWatcher !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('twitter:');
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

export { TwitterClient, TwitterConfig, createClient } from './client.js';
