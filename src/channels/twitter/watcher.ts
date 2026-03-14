import type { Tweet } from 'agent-twitter-client';

import { logger } from '../../logger.js';
import { InboundEvent, OnInboundMessage, Platform, Verb } from '../../types.js';
import { TwitterClient } from './client.js';

const log = logger.child({ channel: 'twitter' });
const POLL_MS = 30_000;

function toMessage(tweet: Tweet): InboundEvent {
  const handle = tweet.username ?? tweet.userId ?? 'unknown';
  return {
    id: tweet.id ?? `${Date.now()}`,
    chat_jid: `twitter:${tweet.userId ?? 'unknown'}`,
    sender: `twitter:${tweet.userId ?? 'unknown'}`,
    sender_name: tweet.name ?? handle,
    content: tweet.text ?? '',
    timestamp: tweet.timeParsed?.toISOString() ?? new Date().toISOString(),
    platform: Platform.Twitter,
    verb: Verb.Message,
  };
}

export async function startWatcher(
  client: TwitterClient,
  onMsg: OnInboundMessage,
): Promise<() => void> {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sinceId: string | undefined;

  async function fetchMentions(): Promise<void> {
    const handle = client.username;
    if (!handle) return;

    // Search for recent mentions of this account
    const query = `@${handle}`;
    const tweets: Tweet[] = [];

    // searchTweets returns an async generator
    for await (const tweet of client.scraper.searchTweets(query, 20)) {
      // Skip own tweets and tweets older than sinceId
      if (tweet.userId === client.userId) continue;
      if (sinceId && tweet.id && BigInt(tweet.id) <= BigInt(sinceId)) continue;
      tweets.push(tweet);
    }

    // Process oldest first
    tweets.reverse();

    for (const tweet of tweets) {
      const msg = toMessage(tweet);
      onMsg(msg.chat_jid, msg);
    }

    // Update cursor to newest tweet
    if (tweets.length > 0) {
      const newest = tweets[tweets.length - 1];
      if (newest.id) sinceId = newest.id;
    }
  }

  function poll(): void {
    if (!running) return;
    fetchMentions()
      .catch((err) => log.error({ err }, 'poll error'))
      .finally(() => {
        if (running) timer = setTimeout(poll, POLL_MS);
      });
  }

  // Start polling (no streaming available with scraper)
  poll();

  return () => {
    running = false;
    if (timer) clearTimeout(timer);
  };
}
