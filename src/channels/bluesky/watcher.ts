import { AtpAgent } from '@atproto/api';

import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';

const log = logger.child({ channel: 'bluesky' });
const POLL_MS = 10_000;

function toMessage(n: {
  uri: string;
  reason: string;
  author: { did: string; handle: string; displayName?: string };
  record: Record<string, unknown>;
  indexedAt: string;
}): NewMessage {
  const rec = n.record as {
    text?: string;
    reply?: { parent?: { uri: string }; root?: { uri: string } };
    createdAt?: string;
  };
  const parentUri = rec.reply?.parent?.uri;
  return {
    id: n.uri,
    chat_jid: `bluesky:${n.author.did}`,
    sender: `bluesky:~${n.author.did}#${n.author.displayName || n.author.handle}`,
    sender_name: n.author.displayName || n.author.handle,
    content: rec.text ?? '',
    timestamp: rec.createdAt ?? n.indexedAt,
    verb: n.reason === 'reply' ? Verb.Reply : Verb.Message,
    platform: Platform.Bluesky,
    replyTo: parentUri,
    root: rec.reply?.root?.uri,
    parent: parentUri,
  };
}

export function startWatcher(
  agent: AtpAgent,
  onMsg: OnInboundMessage,
): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cursor: string | undefined;

  async function poll(): Promise<void> {
    if (closed) return;
    try {
      const res = await agent.listNotifications({
        reasons: ['reply', 'mention'],
        limit: 25,
        cursor,
      });
      const notifs = res.data.notifications;
      if (notifs.length > 0) {
        cursor = res.data.cursor;
        for (const n of notifs) {
          if (n.isRead) continue;
          const msg = toMessage(n);
          onMsg(msg.chat_jid, msg);
        }
        await agent.updateSeenNotifications();
      }
    } catch (e) {
      log.warn({ err: e }, 'notification poll failed');
    }
    if (!closed) timer = setTimeout(poll, POLL_MS);
  }

  poll();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
