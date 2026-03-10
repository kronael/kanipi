import { registerClient, unregisterClient } from '../../actions/social.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { MastodonClient, MastodonConfig, createClient } from './client.js';
import { startWatcher } from './watcher.js';

const log = logger.child({ channel: 'mastodon' });

export class MastodonChannel implements Channel {
  readonly name = 'mastodon';
  private client: MastodonClient;
  private stopWatcher: (() => void) | null = null;

  constructor(
    private config: MastodonConfig,
    private opts: ChannelOpts,
  ) {
    this.client = createClient(config);
  }

  async connect(): Promise<void> {
    registerClient('mastodon', this.client);

    try {
      const me = await this.client.api.v1.accounts.verifyCredentials();
      this.opts.onChatMetadata(
        `mastodon:${me.id}`,
        new Date().toISOString(),
        me.displayName || me.username,
        'mastodon',
      );
      log.info('connected as @%s', me.username);
    } catch (e) {
      log.warn('failed to verify credentials: %s', e);
    }

    this.stopWatcher = await startWatcher(
      this.client,
      this.config,
      this.opts.onMessage,
    ).catch((e) => {
      log.error('watcher failed: %s', e);
      return null;
    });
  }

  async disconnect(): Promise<void> {
    this.stopWatcher?.();
    this.stopWatcher = null;
    unregisterClient('mastodon');
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.stopWatcher !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('mastodon:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<void> {
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
  }
}

export { MastodonClient, MastodonConfig, createClient } from './client.js';
