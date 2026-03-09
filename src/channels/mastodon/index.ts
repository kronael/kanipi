import { registerClient, unregisterClient } from '../../actions/social.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { MastodonClient, MastodonConfig, createClient } from './client.js';

export class MastodonChannel implements Channel {
  readonly name = 'mastodon';
  private client: MastodonClient | null = null;

  constructor(
    private config: MastodonConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = createClient(this.config);
    registerClient('mastodon', this.client);
    void this.opts;
  }

  async disconnect(): Promise<void> {
    unregisterClient('mastodon');
    this.client = null;
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('mastodon:');
  }

  async sendMessage(
    jid: string,
    text: string,
    _opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('mastodon not connected');
    await this.client.post(text);
    void jid;
  }
}

export { MastodonClient, MastodonConfig, createClient } from './client.js';
