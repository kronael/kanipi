import { registerClient, unregisterClient } from '../../actions/social.js';
import { Channel, ChannelOpts, SendOpts } from '../../types.js';
import { BlueskyClient, BlueskyConfig, createClient } from './client.js';

export class BlueskyChannel implements Channel {
  readonly name = 'bluesky';
  private client: BlueskyClient | null = null;

  constructor(
    private config: BlueskyConfig,
    private opts: ChannelOpts,
  ) {}

  async connect(): Promise<void> {
    this.client = createClient(this.config);
    await this.client.connect();
    registerClient('bluesky', this.client);
    void this.opts;
  }

  async disconnect(): Promise<void> {
    unregisterClient('bluesky');
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

export { BlueskyClient, BlueskyConfig, createClient } from './client.js';
