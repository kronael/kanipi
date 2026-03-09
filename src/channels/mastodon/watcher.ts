import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { MastodonClient, MastodonConfig } from './client.js';

export class MastodonWatcher implements Channel {
  readonly name = 'mastodon';
  private client: MastodonClient | null = null;

  constructor(
    private config: MastodonConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = new MastodonClient(this.config);
    void this.opts;
    // Streaming inbound events: future work
  }

  async disconnect(): Promise<void> {
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
