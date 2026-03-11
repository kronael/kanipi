import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { FacebookConfig } from './client.js';

const log = logger.child({ channel: 'facebook' });
const POLL_MS = 30_000;

export function startWatcher(
  cfg: FacebookConfig,
  onMsg: OnInboundMessage,
): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastTs = '';
  const v = cfg.graphApiVersion ?? 'v21.0';
  const base = `https://graph.facebook.com/${v}`;

  async function poll(): Promise<void> {
    if (closed) return;
    try {
      const url =
        `${base}/${cfg.pageId}/feed` +
        `?fields=id,message,from,created_time&limit=10&access_token=${cfg.pageAccessToken}`;
      const res = await fetch(url);
      if (!res.ok) {
        log.warn({ status: res.status }, 'feed fetch failed');
      } else {
        const data = (await res.json()) as {
          data: Array<{
            id: string;
            message?: string;
            from?: { id: string; name: string };
            created_time: string;
          }>;
        };
        for (const p of data.data) {
          if (!p.message || !p.from) continue;
          if (p.from.id === cfg.pageId) continue;
          if (lastTs && p.created_time <= lastTs) continue;
          const msg: NewMessage = {
            id: p.id,
            chat_jid: `facebook:${cfg.pageId}`,
            sender: `facebook:${p.from.id}`,
            sender_name: p.from.name,
            content: p.message,
            timestamp: p.created_time,
            verb: Verb.Message,
            platform: Platform.Facebook,
          };
          onMsg(msg.chat_jid, msg);
        }
        if (data.data.length > 0) lastTs = data.data[0].created_time;
      }
    } catch (err) {
      log.warn({ err }, 'poll error');
    }
    if (!closed) timer = setTimeout(poll, POLL_MS);
  }

  poll();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
