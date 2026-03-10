import { createStreamingAPIClient, type mastodon } from 'masto';

import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
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
    private onMsg: OnInboundMessage,
    private instanceUrl: string,
    private accessToken: string,
  ) {}

  async start(): Promise<void> {
    let streamUrl = this.instanceUrl;
    try {
      const inst = await this.client.api.v2.instance.fetch();
      if (inst.configuration?.urls?.streaming) {
        streamUrl = inst.configuration.urls.streaming;
      }
    } catch {
      log.warn('failed to fetch instance info, using base URL for streaming');
    }

    this.streaming = createStreamingAPIClient({
      streamingApiUrl: streamUrl,
      accessToken: this.accessToken,
    });

    this.sub = this.streaming.user.subscribe();
    log.info('streaming connected');
    void this.consume();
  }

  private async consume(): Promise<void> {
    if (!this.sub) return;
    try {
      for await (const ev of this.sub) {
        this.handleEvent(ev);
      }
    } catch (e) {
      log.error('streaming error: %s', e);
    }
  }

  private handleEvent(ev: mastodon.streaming.Event): void {
    if (ev.event !== 'notification') return;
    const n = ev.payload as mastodon.v1.Notification;
    if (n.type !== 'mention' || !n.status) return;

    const msg: NewMessage = {
      id: n.status.id,
      chat_jid: `mastodon:${n.account.id}`,
      sender: n.account.acct,
      sender_name: n.account.displayName || n.account.username,
      content: stripHtml(n.status.content),
      timestamp: n.status.createdAt ?? new Date().toISOString(),
      platform: Platform.Mastodon,
      verb: Verb.Message,
      replyTo: n.status.inReplyToId ?? undefined,
    };

    log.debug('mention from @%s: %s', n.account.acct, msg.content);
    this.onMsg(msg.chat_jid, msg);
  }

  async stop(): Promise<void> {
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
