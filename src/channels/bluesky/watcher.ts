import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { BlueskyClient, BlueskyConfig } from './client.js';

export class BlueskyWatcher implements Channel {
  readonly name = 'bluesky';
  private client: BlueskyClient | null = null;

  constructor(
    private config: BlueskyConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = new BlueskyClient(this.config);
    await this.client.connect();
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
    return jid.startsWith('bluesky:');
  }

  async sendMessage(
    jid: string,
    text: string,
    _opts?: SendOpts,
  ): Promise<void> {
    if (!this.client) throw new Error('bluesky not connected');
    await this.client.post(text);
    void jid;
  }
}
