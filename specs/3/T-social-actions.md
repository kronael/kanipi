# Social Actions — Outbound

**Status**: open

Outbound actions for social platforms. Not a new interface —
entries in the existing action registry, exposed as MCP tools.
Gateway resolves platform from JID prefix.

## Actions

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
| `close`       | gateway (marks thread group closed)             |
| `delete`      | gateway (removes thread group)                  |

## How it works

Each action is a handler in `src/actions/social.ts`, registered
via the action registry (`action-registry.ts`). The agent calls
them as MCP tools — same pattern as `send_message`, `delegate_group`.

The gateway resolves platform from the JID prefix:

```typescript
function platformFromJid(jid: string): Platform {
  const prefix = jid.split(':')[0];
  return prefixMap[prefix]; // 'reddit' | 'x' | 'mastodon' | ...
}
```

Each handler delegates to the platform channel's API client.
No abstraction layer — direct calls per platform with a
switch on `platformFromJid(jid)`.

## Action schemas

```typescript
// post — create new content
{ jid: string, content: string, media?: string[] }

// reply — respond to existing content
{ jid: string, target: string, content: string }

// react — like/upvote/favourite
{ jid: string, target: string, reaction?: string }

// repost — share/boost/retweet
{ jid: string, target: string }

// follow / unfollow
{ jid: string, target: string }

// set_profile — update display name, bio, avatar
{ jid: string, name?: string, bio?: string, avatar?: string }

// delete_post / edit_post
{ jid: string, target: string, content?: string }

// close — mark thread group closed (no new messages)
{ group: string }

// delete — remove thread group entirely
{ group: string }
```

All schemas use Zod, registered in action-registry. `jid`
determines platform. `target` is platform-native ID (post ID,
user ID, etc.).

## Platform specifics

### Mastodon / Bluesky (build first)

Both have excellent TS libraries (megalodon, @atproto/api).
Full API access, no rate limit concerns for normal usage.

- `post`: create status/post with optional media
- `reply`: reply to status by ID
- `react`: favourite/like
- `repost`: boost/repost
- `follow`/`unfollow`: by account ID/DID
- `set_profile`: update display name, bio, avatar
- `edit_post`: mastodon only (bluesky immutable)

### Reddit (build next)

snoowrap or raw API. Rate limited (60/min with OAuth).

- `post`: submit to subreddit (text or link)
- `reply`: comment on post/comment
- `react`: upvote/downvote
- `follow`: subscribe to subreddit
- `set_profile`: limited (description only)
- `edit_post`: edit own posts/comments
- `delete_post`: delete own posts/comments

### Twitter/X (paid tier)

$200/mo Basic API. Strict rate limits.

- `post`: create tweet (280 chars)
- `reply`: reply to tweet
- `react`: like tweet
- `repost`: retweet
- `follow`/`unfollow`: by user ID

### Facebook / Instagram / Threads (gatekept)

Meta Graph API. App review required for most permissions.

- `post`: page post (fb), business post (ig)
- `reply`: comment reply
- `react`: fb only (page reactions)

## Authorization

Same tier model as existing actions. Social actions are
tier 2 (agent) — the agent's group must own the JID or
have explicit permission.

## Open

- Media upload flow — presigned URLs or inline base64?
- Rate limit tracking per platform per JID
- Retry/backoff strategy for transient failures
- Content length validation per platform
- Thread-aware posting (tweet threads, reddit comment chains)
