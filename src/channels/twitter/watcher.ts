import type { TweetV2SingleStreamResult } from 'twitter-api-v2';

import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { TwitterClient } from './client.js';

const log = logger.child({ channel: 'twitter' });
const POLL_MS = 30_000;

function toMessage(
  id: string,
  text: string,
  authorId?: string,
  createdAt?: string,
  users?: Map<string, string>,
): NewMessage {
  const handle = (authorId && users?.get(authorId)) ?? authorId ?? 'unknown';
  return {
    id,
    chat_jid: `twitter:${authorId ?? 'unknown'}`,
    sender: handle,
    sender_name: handle,
    content: text,
    timestamp: createdAt ?? new Date().toISOString(),
    platform: Platform.Twitter,
    verb: Verb.Message,
  };
}

function usersMap(includes?: {
  users?: Array<{ id: string; username: string }>;
}): Map<string, string> {
  return new Map((includes?.users ?? []).map((u) => [u.id, u.username]));
}

export async function startWatcher(
  client: TwitterClient,
  onMsg: OnInboundMessage,
): Promise<() => void> {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sinceId: string | undefined;

  function handleTweet(result: TweetV2SingleStreamResult): void {
    const t = result.data;
    const msg = toMessage(
      t.id,
      t.text,
      t.author_id,
      t.created_at,
      usersMap(result.includes),
    );
    onMsg(msg.chat_jid, msg);
  }

  async function fetchMentions(): Promise<void> {
    const uid = client.userId;
    if (!uid) return;
    const r = await client.api.v2.userMentionTimeline(uid, {
      since_id: sinceId,
      'tweet.fields': ['author_id', 'created_at', 'in_reply_to_user_id'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });
    const tweets = r.data?.data ?? [];
    const users = usersMap(r.data?.includes);
    for (const t of tweets) {
      const msg = toMessage(t.id, t.text, t.author_id, t.created_at, users);
      onMsg(msg.chat_jid, msg);
    }
    if (tweets.length > 0) sinceId = tweets[0].id;
  }

  function poll(): void {
    if (!running) return;
    fetchMentions()
      .catch((err) => log.error({ err }, 'poll error'))
      .finally(() => {
        if (running) timer = setTimeout(poll, POLL_MS);
      });
  }

  try {
    const stream = await client.api.v2.searchStream({
      'tweet.fields': ['author_id', 'created_at', 'in_reply_to_user_id'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    });
    stream.autoReconnect = true;
    stream.on('data', handleTweet);
    stream.on('error', (err: Error) => log.error({ err }, 'stream error'));
    stream.on('reconnect', () => log.info('stream reconnecting'));
  } catch {
    log.info('streaming unavailable, falling back to polling');
    poll();
  }

  return () => {
    running = false;
    if (timer) clearTimeout(timer);
  };
}
