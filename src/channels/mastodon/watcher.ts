import { createStreamingAPIClient, type mastodon } from 'masto';

import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { MastodonClient, MastodonConfig } from './client.js';

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

function handleEvent(
  ev: mastodon.streaming.Event,
  onMsg: OnInboundMessage,
): void {
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
  onMsg(msg.chat_jid, msg);
}

export async function startWatcher(
  client: MastodonClient,
  cfg: MastodonConfig,
  onMsg: OnInboundMessage,
): Promise<() => void> {
  let streamUrl = cfg.instanceUrl;
  try {
    const inst = await client.api.v2.instance.fetch();
    if (inst.configuration?.urls?.streaming) {
      streamUrl = inst.configuration.urls.streaming;
    }
  } catch {
    log.warn('failed to fetch instance info, using base URL for streaming');
  }

  const streaming = createStreamingAPIClient({
    streamingApiUrl: streamUrl,
    accessToken: cfg.accessToken,
  });

  const sub = streaming.user.subscribe();
  log.info('streaming connected');

  void (async () => {
    try {
      for await (const ev of sub) handleEvent(ev, onMsg);
    } catch (e) {
      log.error('streaming error: %s', e);
    }
  })();

  return () => {
    sub.unsubscribe();
    streaming.close();
  };
}
