import { createStreamingAPIClient, type mastodon } from 'masto';

import { logger } from '../../logger.js';
import { ChannelOpts, NewMessage } from '../../types.js';
import { MastodonClient } from './client.js';

const log = logger.child({ channel: 'mastodon' });

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export class MastodonWatcher {
  private sub: mastodon.streaming.Subscription | null = null;
  private streaming: mastodon.streaming.Client | null = null;

  constructor(
    private client: MastodonClient,
    private opts: ChannelOpts,
    private instanceUrl: string,
    private accessToken: string,
  ) {}

  async start(): Promise<void> {
    try {
      const me = await this.client.api.v1.accounts.verifyCredentials();
      this.opts.onChatMetadata(
        `mastodon:${me.id}`,
        new Date().toISOString(),
        me.displayName || me.username,
        'mastodon',
      );
      log.info('mastodon bot account: %s (@%s)', me.id, me.username);
    } catch (e) {
      log.warn('failed to verify mastodon credentials: %s', e);
    }

    let streamingUrl = this.instanceUrl;
    try {
      const inst = await this.client.api.v2.instance.fetch();
      if (inst.configuration?.urls?.streaming) {
        streamingUrl = inst.configuration.urls.streaming;
      }
    } catch {
      log.warn('failed to fetch instance info, using base URL for streaming');
    }

    this.streaming = createStreamingAPIClient({
      streamingApiUrl: streamingUrl,
      accessToken: this.accessToken,
    });

    this.sub = this.streaming.user.subscribe();
    log.info('mastodon streaming connected');
    void this.consume();
  }

  private async consume(): Promise<void> {
    if (!this.sub) return;
    try {
      for await (const event of this.sub) {
        this.handleEvent(event);
      }
    } catch (e) {
      log.error('mastodon streaming error: %s', e);
    }
  }

  private handleEvent(event: mastodon.streaming.Event): void {
    if (event.event !== 'notification') return;
    const n = event.payload as mastodon.v1.Notification;
    if (n.type !== 'mention' || !n.status) return;

    const msg: NewMessage = {
      id: n.status.id,
      chat_jid: `mastodon:${n.account.id}`,
      sender: n.account.acct,
      sender_name: n.account.displayName || n.account.username,
      content: stripHtml(n.status.content),
      timestamp: n.status.createdAt ?? new Date().toISOString(),
      platform: 'mastodon',
      verb: 'message',
      replyTo: n.status.inReplyToId ?? undefined,
    };

    log.debug('mastodon mention from @%s: %s', n.account.acct, msg.content);
    this.opts.onMessage(msg.chat_jid, msg);
  }

  stop(): void {
    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    if (this.streaming) {
      this.streaming.close();
      this.streaming = null;
    }
  }
}
