import path from 'path';

import { registerClient, unregisterClient } from '../../actions/social.js';
import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { BlueskyClient, BlueskyConfig, createClient } from './client.js';
import { BlueskyWatcher } from './watcher.js';

const log = logger.child({ channel: 'bluesky' });

export class BlueskyChannel implements Channel {
  readonly name = 'bluesky';
  private client: BlueskyClient | null = null;
  private watcher: BlueskyWatcher | null = null;

  constructor(
    private config: BlueskyConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    const cfg = {
      ...this.config,
      sessionPath: path.join(STORE_DIR, 'bluesky-session.json'),
    };
    this.client = createClient(cfg);
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

    this.watcher = new BlueskyWatcher(
      this.client.atpAgent,
      this.opts.onMessage,
    );
    this.watcher.start();
    log.info({ did: this.client.did }, 'watcher started');
  }

  async disconnect(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    unregisterClient('bluesky');
    this.client = null;
    log.info('disconnected');
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('bluesky:');
  }

  async sendMessage(
    _jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('bluesky not connected');
    if (opts?.replyTo) {
      await this.client.reply(opts.replyTo, text);
    } else {
      await this.client.post(text);
    }
  }
}

export { BlueskyClient, BlueskyConfig, createClient } from './client.js';
