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
| `ban`         | reddit, discord, twitch, youtube, mastodon      |
| `unban`       | reddit, discord, twitch, mastodon               |
| `timeout`     | discord, twitch, youtube                        |
| `mute`        | reddit, twitter, mastodon, bluesky              |
| `block`       | twitter, mastodon, bluesky, twitch              |
| `pin`         | reddit, mastodon, discord                       |
| `unpin`       | reddit, mastodon, discord                       |
| `lock`        | reddit, discord                                 |
| `unlock`      | reddit, discord                                 |
| `hide`        | youtube, facebook, instagram                    |
| `approve`     | reddit, youtube, mastodon                       |
| `set_flair`   | reddit                                          |

## Architecture

See `U-channel-actions.md` for registration, filtering, and
the generic agent-runner proxy. Each channel exports actions
from `src/channels/{platform}/actions.ts`, registered on
connect, filtered per group in the manifest.

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

// ban / unban — remove user from community
{ jid: string, target: string, duration?: number, reason?: string }

// timeout — temporary mute (seconds)
{ jid: string, target: string, duration: number }

// mute / block — account-level silencing
{ jid: string, target: string }

// pin / unpin — sticky content
{ jid: string, target: string }

// lock / unlock — prevent new replies
{ jid: string, target: string }

// hide — suppress content without deleting
{ jid: string, target: string }

// approve — release from moderation queue
{ jid: string, target: string }

// set_flair — tag content or user
{ jid: string, target: string, flair: string }
```

All schemas use Zod, registered in action-registry. `jid`
determines platform. `target` is platform-native ID (post ID,
user ID, etc.).

## Platform specifics

### Mastodon / Bluesky (build first)

TS libs: megalodon, @atproto/api. Full API, no rate concerns.

Content: post, reply, react, repost, edit (mastodon only),
delete, pin (mastodon max 5). Account: follow, unfollow,
set_profile. Moderation: ban/unban (mastodon admin scope),
mute, block. Bluesky uses labeling system instead of bans.

### Reddit (build next)

snoowrap or raw API. 60 req/min with OAuth.

Content: post (text/link to subreddit), reply, react
(upvote/downvote), edit, delete, pin (max 2 sticky),
lock/unlock threads. Account: follow (subscribe to sub),
set_profile (description only). Moderation: ban/unban
(subreddit-scoped, temp+perm), approve (mod queue),
set_flair (post and user flair).

### Discord (existing channel, add moderation)

Content: pin/unpin (max 50 per channel), lock/unlock
(thread archive). Moderation: ban/unban, timeout (up to
28d), kick.

### Twitch (build next)

Content: delete (chat messages). Moderation: ban/unban,
timeout (1s–2w), block, shield mode toggle, slow mode,
follower-only mode, sub-only mode.

### YouTube (paid tier)

Content: delete (comments on own content), hide
(setModerationStatus). Moderation: ban (live chat only),
timeout (live chat), approve (comment moderation queue).

### Twitter/X (paid tier)

$200/mo Basic API. Strict rate limits.

Content: post (280 chars), reply, react, repost, delete.
Account: follow, unfollow, mute, block.
No community moderation via API.

### Facebook / Instagram / Threads (gatekept)

Meta Graph API. App review required.

Content: post (page/business), reply, react (fb only),
delete, hide/unhide (comments). Instagram: disable
comments per media. Threads: reply audience controls only.

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
