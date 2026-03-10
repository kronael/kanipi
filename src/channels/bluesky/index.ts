import { registerClient, unregisterClient } from '../../actions/social.js';
import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { BlueskyClient, BlueskyConfig, createClient } from './client.js';
import { startWatcher } from './watcher.js';

const log = logger.child({ channel: 'bluesky' });

export class BlueskyChannel implements Channel {
  readonly name = 'bluesky';
  private client: BlueskyClient;
  private stopWatcher: (() => void) | null = null;

  constructor(
    private config: BlueskyConfig,
    private opts: ChannelOpts,
  ) {
    this.client = createClient({
      ...config,
      sessionPath: `${STORE_DIR}/bluesky-session.json`,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    registerClient('bluesky', this.client);

    if (this.client.did) {
      this.opts.onChatMetadata(
        `bluesky:${this.client.did}`,
        new Date().toISOString(),
        this.config.identifier,
        'bluesky',
      );
    }

    this.stopWatcher = startWatcher(this.client.agent, this.opts.onMessage);
    log.info({ did: this.client.did }, 'watcher started');
  }

  async disconnect(): Promise<void> {
    this.stopWatcher?.();
    this.stopWatcher = null;
    unregisterClient('bluesky');
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.stopWatcher !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('bluesky:');
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

export { BlueskyClient, BlueskyConfig, createClient } from './client.js';
