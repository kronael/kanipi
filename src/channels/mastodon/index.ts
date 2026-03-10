import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { MastodonClient, MastodonConfig, createClient } from './client.js';
import { MastodonWatcher } from './watcher.js';

const log = logger.child({ channel: 'mastodon' });

export class MastodonChannel implements Channel {
  readonly name = 'mastodon';
  private client: MastodonClient | null = null;
  private watcher: MastodonWatcher | null = null;

  constructor(
    private config: MastodonConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = createClient(this.config);
    registerClient('mastodon', this.client);

    this.watcher = new MastodonWatcher(
      this.client,
      this.opts,
      this.config.instanceUrl,
      this.config.accessToken,
    );
    void this.watcher.start().catch((e) => {
      log.error('mastodon watcher failed: %s', e);
    });

    log.info('mastodon connected to %s', this.config.instanceUrl);
  }

  async disconnect(): Promise<void> {
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
    unregisterClient('mastodon');
    this.client = null;
    log.info('mastodon disconnected');
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('mastodon:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('mastodon not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
  }
}

export { MastodonClient, MastodonConfig, createClient } from './client.js';
