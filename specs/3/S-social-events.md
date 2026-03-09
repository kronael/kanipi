# Social Events — Unified Inbound Model

**Status**: open

Normalize inbound events from all platforms into a typed
event struct. Gateway filters by impulse weights and routes
by verb. Agents see a uniform stream.

## InboundEvent

Replaces `NewMessage` as the gateway's internal event type.
Existing `NewMessage` fields map 1:1 (additive change).

```typescript
const Verb = {
  Message: 'message',
  Mention: 'mention',
  Reply: 'reply',
  Post: 'post',
  React: 'react',
  Repost: 'repost',
  Follow: 'follow',
  Join: 'join',
  Edit: 'edit',
  Delete: 'delete',
} as const;

type Verb = (typeof Verb)[keyof typeof Verb];

const Platform = {
  Telegram: 'telegram',
  WhatsApp: 'whatsapp',
  Discord: 'discord',
  Email: 'email',
  Web: 'web',
  Reddit: 'reddit',
  Twitter: 'twitter',
  Mastodon: 'mastodon',
  Bluesky: 'bluesky',
  Twitch: 'twitch',
  YouTube: 'youtube',
  Facebook: 'facebook',
  Instagram: 'instagram',
  Threads: 'threads',
  LinkedIn: 'linkedin',
} as const;

type Platform = (typeof Platform)[keyof typeof Platform];

interface InboundEvent {
  id: string;
  platform: Platform;
  jid: string;
  sender: string;
  sender_name?: string;
  timestamp: string;

  verb: Verb;
  content?: string;

  // thread position
  thread?: string;
  parent?: string;
  root?: string;

  // object acted upon
  target?: string;
  target_author?: string;

  // compat
  is_from_me?: boolean;
  is_bot_message?: boolean;
  forwarded_from?: string;
}
```

Verb and Platform are const objects — typed at compile time,
serialized as strings in JSON/IPC/DB.

## Platform mapping

### Chat channels (existing — verb is always Message)

| Source            | verb    | content | thread    |
| ----------------- | ------- | ------- | --------- |
| Telegram chat msg | Message | text    | -         |
| WhatsApp msg      | Message | text    | -         |
| Discord msg       | Message | text    | threadId  |
| Email direct      | Message | text    | thread_id |
| Web (slink)       | Message | text    | -         |

### Reddit

| Source              | verb    | thread  | target     |
| ------------------- | ------- | ------- | ---------- |
| DM received         | Message | -       | -          |
| Comment on our post | Reply   | post_id | post_id    |
| Username mention    | Mention | post_id | comment_id |
| New post in r/sub   | Post    | -       | -          |
| Upvote on our post  | React   | -       | post_id    |

### Twitter/X

| Source             | verb    | thread   | target   |
| ------------------ | ------- | -------- | -------- |
| DM received        | Message | -        | -        |
| @mention tweet     | Mention | tweet_id | -        |
| Reply to our tweet | Reply   | tweet_id | tweet_id |
| Like on our tweet  | React   | -        | tweet_id |
| Retweet            | Repost  | -        | tweet_id |
| New follower       | Follow  | -        | -        |

### Mastodon / Bluesky

| Source            | verb    | thread    | target    |
| ----------------- | ------- | --------- | --------- |
| DM (direct vis.)  | Message | -         | -         |
| @mention          | Mention | status_id | -         |
| Reply to our post | Reply   | status_id | status_id |
| Favourite/like    | React   | -         | status_id |
| Boost/repost      | Repost  | -         | status_id |
| New follower      | Follow  | -         | -         |

### Email

| Source            | verb    | thread    | target |
| ----------------- | ------- | --------- | ------ |
| Direct email      | Message | thread_id | -      |
| Reply in thread   | Reply   | thread_id | msg_id |
| Mailing list post | Post    | list_id   | -      |

### Twitch / YouTube

| Source           | verb    | thread    | target   |
| ---------------- | ------- | --------- | -------- |
| Chat message     | Message | stream_id | -        |
| Comment on video | Reply   | video_id  | video_id |
| New follower/sub | Follow  | -         | -        |

### Facebook / Instagram / Threads

| Source          | verb    | thread  | target  |
| --------------- | ------- | ------- | ------- |
| Messenger DM    | Message | -       | -       |
| Comment on post | Reply   | post_id | post_id |
| @mention        | Mention | -       | post_id |
| Page reaction   | React   | -       | post_id |

## Impulse filter

Separate module: `src/impulse.ts`. Pure function, no side
effects, no DB, no platform knowledge. Gateway calls it
between message discovery and queue enqueue.

Each verb has an integer weight. Events accumulate impulse
per group. When sum ≥ threshold, flush pending events to
the group queue. Safety timeout flushes even if threshold
never reached.

```typescript
interface ImpulseConfig {
  threshold: number; // default: 100
  weights: Partial<Record<Verb, number>>; // per-verb weight
  max_hold_ms: number; // safety flush (default: 300000)
}

interface ImpulseState {
  pending: InboundEvent[];
  impulse: number;
  last_flush: number; // timestamp ms
}

interface FlushResult {
  events: InboundEvent[]; // all pending events
  immediate: InboundEvent[]; // weight ≥ threshold (full delivery)
  batched: InboundEvent[]; // weight < threshold (summary)
}

function accumulate(
  state: ImpulseState,
  event: InboundEvent,
  config: ImpulseConfig,
): { state: ImpulseState; flush: FlushResult | null };

function checkTimeout(
  state: ImpulseState,
  config: ImpulseConfig,
): FlushResult | null;
```

### Default weights

| Verb    | Weight | Effect at threshold 100 |
| ------- | ------ | ----------------------- |
| Message | 100    | immediate               |
| Mention | 100    | immediate               |
| Reply   | 100    | immediate               |
| Post    | 30     | ~3 posts trigger        |
| React   | 5      | ~20 likes trigger       |
| Repost  | 10     | ~10 reposts trigger     |
| Follow  | 10     | ~10 follows trigger     |
| Join    | 0      | ignored                 |
| Edit    | 0      | ignored                 |
| Delete  | 0      | ignored                 |

Weight 0 = drop. Weight ≥ threshold = immediate flush.
Operator configures `weights` and `threshold` per group.

### Where it sits in code

```
index.ts startMessageLoop()
  getNewMessages()           // poll DB for new messages
  → for each group:
    → impulse.accumulate()   // <-- new, per-group state
    → if flush:
        resolveRoutingTarget()
        queue.enqueueMessageCheck()
  → impulse.checkTimeout()   // <-- new, end of loop tick
```

The impulse state lives in a `Map<string, ImpulseState>`
keyed by group JID, alongside the existing message loop
state. Existing chat channels have weight 100 for Message,
so every message flushes immediately — zero behavior change.

### Flush delivery

Immediate events (weight ≥ threshold) are delivered as
individual messages with full content. Batched events
(weight < threshold) are formatted as a summary line
appended to the prompt:

```
[5 reactions on post abc123, 3 reposts, 10 new followers]
```

## Routing by verb

Existing routing rules gain a `verb` type:

```typescript
| { type: 'verb'; verb: Verb; target: string }
```

Evaluation order: command → verb → pattern → keyword →
sender → default.

```json
[
  { "type": "verb", "verb": "post", "target": "main/feed" },
  { "type": "verb", "verb": "reply", "target": "main/support" },
  { "type": "verb", "verb": "message", "target": "main/dm" }
]
```

## Thread routing

Per-group config: `thread_mode: 'inject' | 'spawn'`.

- **inject** (default): thread context prefixed to message.
  `[thread:abc123 reply-to:def456] message text`.
  All thread events go to same group.
- **spawn**: route to child group named by thread ID.
  If the child group doesn't exist, the gateway creates it
  (see "Auto-spawning" below).

## Auto-spawning groups

When the router resolves a target group that doesn't exist,
the gateway creates it. This replaces the prototypes spec
as a simpler mechanism.

Rules:

- Parent group must exist and be registered
- Target must be a valid descendant of the parent
- Parent's `max_children` config limits open subgroups
  (default: 50, prevents runaway from config errors)
- New group inherits parent's CLAUDE.md, skills, SOUL.md
- New group gets its own workdir, session, memory

```typescript
// registered_groups column
max_children?: number;  // default: 50, 0 = no spawning
```

When `max_children` is reached, new threads route to the
parent instead (fallback, not error).

The gateway copies the parent's group folder to create the
child. No template/prototype concept — the parent IS the
template.

```
groups/
  main/reddit/          parent (registered, has config)
    CLAUDE.md
    SOUL.md
  main/reddit/post_abc  auto-spawned child
    CLAUDE.md           copied from parent
    SOUL.md             copied from parent
```

Cleanup: children with no messages in N days are removed
(configurable via `spawn_ttl_days`, default: 7).

## Migration from NewMessage

Additive. No breaking change.

1. Add `verb: Verb` and `platform: Platform` to `NewMessage`
2. Add optional `thread`, `parent`, `root`, `target`,
   `target_author`
3. Existing channels set `verb: Verb.Message`
4. Rename `NewMessage` → `InboundEvent` when stable

Field mapping:

- `chat_jid` → `jid`
- `replyTo` → `parent`
- `reply_to_text`, `reply_to_sender` → dropped (DB lookup)

## Upstream (outbound actions)

Not an interface — actions in the action registry, exposed
as MCP tools. Gateway resolves platform from JID prefix.

| Action        | Platforms                                       |
| ------------- | ----------------------------------------------- |
| `post`        | reddit, twitter, mastodon, bluesky, fb, threads |
| `reply`       | all                                             |
| `react`       | all                                             |
| `repost`      | twitter, mastodon, bluesky                      |
| `follow`      | reddit, twitter, mastodon, bluesky              |
| `unfollow`    | reddit, twitter, mastodon, bluesky              |
| `set_profile` | mastodon, bluesky, reddit                       |
| `delete_post` | all                                             |
| `edit_post`   | reddit, mastodon, fb                            |

## JID format

| Platform  | DM JID                     | Feed JID                        |
| --------- | -------------------------- | ------------------------------- |
| Reddit    | `reddit:u_{user}`          | `reddit:r_{sub}`                |
| Twitter   | `x:{userId}`               | `x:{userId}:feed`               |
| Mastodon  | `mastodon:{instance}:{id}` | `mastodon:{instance}:{id}:feed` |
| Bluesky   | `bsky:{did}`               | `bsky:{did}:feed`               |
| Twitch    | `twitch:{channel}`         | -                               |
| YouTube   | `yt:{channelId}:live`      | `yt:{channelId}:comments`       |
| Facebook  | `fb:{threadId}`            | `fb:page:{pageId}`              |
| Instagram | `ig:{threadId}`            | `ig:biz:{accountId}`            |
| Threads   | `threads:{userId}`         | -                               |
| LinkedIn  | `li:page:{pageId}`         | -                               |

## Platform viability

| Tier        | Platforms                            | Notes                                |
| ----------- | ------------------------------------ | ------------------------------------ |
| Build first | Mastodon, Bluesky                    | Free, open, streaming, great TS libs |
| Build next  | Reddit, Twitch                       | Free, polling, large audience        |
| Paid        | Twitter/X ($200/mo), YouTube (quota) | Official, stable                     |
| Gatekept    | Facebook, Instagram, LinkedIn        | App review required                  |
| Skip        | TikTok                               | Video-only, no comment API           |

## Open

- Batch summary format — XML tags or plain text brackets?
- React `content` field carries reaction value (upvote,
  emoji, etc.)
- Rate limit backoff config per platform
- Media attachments — reuse `RawAttachment` pipeline
- Platform auth failure handling (disable, retry, alert)
- Spawn cleanup: cron job or lazy on next message loop tick?
