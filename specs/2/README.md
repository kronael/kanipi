# Phase 2 — Social Channels (shipped)

Five platforms, 27 actions, unified watcher/client/action pattern.

## Platform Status

| Platform | Watcher   | Core Actions | Moderation | Media Upload |
| -------- | --------- | ------------ | ---------- | ------------ |
| Mastodon | streaming | 15/23        | partial    | not wired    |
| Bluesky  | poll 10s  | 10/23        | stubs      | not wired    |
| Reddit   | poll 30s  | 8/23         | stubs      | not wired    |
| Twitter  | poll 30s  | 5/23         | stubs      | not wired    |
| Facebook | poll 30s  | 8/23         | partial    | not wired    |

Core = post, reply, react, repost, follow, delete, edit, profile.
Moderation = ban, mute, block, pin, lock, hide, approve, kick.

## What Works

- All 5 platforms connect, poll/stream, produce NewMessage objects
- Unified client registry dispatches actions by platform
- Impulse filter batches low-weight events, flushes at threshold
- Actions exposed as MCP tools to container agents
- Config via env vars, enabled by token presence
- Zod schemas on all action inputs

## Known Gaps

### Consistency

| Issue                  | Platforms affected | Severity |
| ---------------------- | ------------------ | -------- |
| Verb always `Message`  | Twitter, Facebook  | low      |
| No parent/root fields  | Twitter, Facebook  | low      |
| sender_name fallback   | Twitter (handle)   | cosmetic |
| Bluesky 10s poll       | Bluesky            | risk     |
| No streaming reconnect | Mastodon           | medium   |

### Missing Features

- **Media upload**: action schemas accept `media?: string[]` but
  all clients ignore it — media is always dropped
- **Subreddit monitoring**: `RedditWatcher` accepts subreddits
  array but `index.ts` doesn't pass it
- **Manifest filtering**: agents see all 27 actions regardless of
  which platforms are configured (phase 3 k-channel-actions)

### Spec Drift

- Code uses `NewMessage` / `chat_jid`; specs reference
  `InboundEvent` / `jid` — rename deferred to JID format work
- Bluesky and Mastodon have no dedicated spec files (implemented
  beyond spec, documented here instead)

### Moderation Action Coverage

| Action      | Mastodon | Bluesky | Reddit | Twitter | Facebook |
| ----------- | -------- | ------- | ------ | ------- | -------- |
| ban         | report   | -       | -      | -       | ✓        |
| unban       | -        | -       | -      | -       | ✓        |
| mute        | ✓        | ✓       | -      | -       | -        |
| block       | ✓        | ✓       | -      | -       | ✓        |
| pin/unpin   | ✓        | -       | -      | -       | -        |
| hide        | -        | -       | -      | -       | ✓        |
| approve     | ✓        | -       | -      | -       | -        |
| lock/unlock | -        | -       | -      | -       | -        |

`-` = stub (throws "not implemented"). Expected — platforms
don't all support the same moderation primitives.

## Testing

- `src/actions/social.test.ts`: client registry, platform routing,
  action dispatch (passes)
- Watchers: no unit tests (integration-tested in production)
- Auth flows: not tested (platform-specific)

## Config Reference

```
MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN
BLUESKY_IDENTIFIER, BLUESKY_PASSWORD, BLUESKY_SERVICE_URL (optional)
REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
TWITTER_USERNAME, TWITTER_PASSWORD, TWITTER_EMAIL
FACEBOOK_PAGE_ID, FACEBOOK_PAGE_ACCESS_TOKEN
```

All enabled by token presence. No flags needed.

## Files

```
src/channels/mastodon/   watcher.ts, client.ts, index.ts
src/channels/bluesky/    watcher.ts, client.ts, index.ts
src/channels/reddit/     watcher.ts, client.ts, index.ts
src/channels/twitter/    watcher.ts, client.ts, index.ts
src/channels/facebook/   watcher.ts, client.ts, index.ts
src/actions/social.ts    27 actions, client registry
src/impulse.ts           event batching/weighting filter
```
