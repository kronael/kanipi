import { logger } from '../../logger.js';
import { NewMessage, OnInboundMessage, Platform, Verb } from '../../types.js';
import { RedditClient } from './client.js';

const log = logger.child({ channel: 'reddit' });
const POLL_MS = 30_000;

interface RedditThing {
  kind: string;
  data: {
    name: string;
    author: string;
    body?: string;
    selftext?: string;
    title?: string;
    subreddit?: string;
    created_utc: number;
    id: string;
    parent_id?: string;
    link_id?: string;
  };
}

interface Listing {
  data: { children: RedditThing[] };
}

function toMessage(thing: RedditThing, source: string): NewMessage {
  const d = thing.data;
  const jid =
    source === 'inbox'
      ? `reddit:${d.author}`
      : `reddit:${d.subreddit ?? source}`;
  return {
    id: d.name,
    chat_jid: jid,
    sender: `reddit:~${d.author}#${d.author}`,
    sender_name: d.author,
    content: d.body ?? d.selftext ?? d.title ?? '',
    timestamp: new Date(d.created_utc * 1000).toISOString(),
    platform: Platform.Reddit,
    verb: thing.kind === 't1' ? Verb.Reply : Verb.Post,
    parent: d.parent_id,
    root: d.link_id,
  };
}

async function pollListing(
  client: RedditClient,
  path: string,
  key: string,
  lastSeen: Map<string, string>,
  onMsg: OnInboundMessage,
  source: string,
): Promise<void> {
  const before = lastSeen.get(key);
  const qs = before ? `?before=${before}` : '?limit=25';
  const listing = (await client.fetchJson(`${path}${qs}`)) as Listing;
  const items = listing.data.children;
  if (!items.length) return;
  lastSeen.set(key, items[0].data.name);
  if (!before) return;
  for (const item of items.reverse()) {
    const msg = toMessage(item, source);
    onMsg(msg.chat_jid, msg);
  }
}

export function startWatcher(
  client: RedditClient,
  onMsg: OnInboundMessage,
  subreddits: string[] = [],
): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const lastSeen = new Map<string, string>();

  async function poll(): Promise<void> {
    if (closed) return;
    try {
      await pollListing(
        client,
        '/message/inbox.json',
        'inbox',
        lastSeen,
        onMsg,
        'inbox',
      );
      for (const sr of subreddits) {
        await pollListing(
          client,
          `/r/${sr}/new.json`,
          `sr:${sr}`,
          lastSeen,
          onMsg,
          sr,
        );
      }
    } catch (err) {
      log.error({ err }, 'poll error');
    }
    if (!closed) timer = setTimeout(poll, POLL_MS);
  }

  poll();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };
}
