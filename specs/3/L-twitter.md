# Twitter/X channel

Inbound/outbound via `twitter-api-v2` with OAuth 1.0a.
Paid API ($200/mo Basic tier minimum).

## Source and sink

- **Inbound**: filtered stream with fallback to polling mentions
- **Outbound**: tweet, reply, repost, like, DM
- Enabled by: `TWITTER_APP_KEY` + `TWITTER_APP_SECRET` + `TWITTER_ACCESS_TOKEN` + `TWITTER_ACCESS_SECRET`

## JID format

`twitter:{userId}` for DMs and @mentions.

## Library

`twitter-api-v2` — official v1.1 + v2 API wrapper. OAuth 1.0a user context.

## Auth flow

1. Create app at developer.twitter.com → get API key + secret
2. Generate user access token + secret (read+write permissions)
3. All four tokens in .env, no login flow needed

## Config

```env
TWITTER_APP_KEY=...
TWITTER_APP_SECRET=...
TWITTER_ACCESS_TOKEN=...
TWITTER_ACCESS_SECRET=...
```

## V1 scope (current)

- Mentions via filtered stream (fallback: polling every 30s)
- Post, reply, like, retweet, follow/unfollow, delete, set profile
- Single bot account per instance

## V2 scope (future)

- Timeline monitoring (watched accounts/keywords)
- DM support (requires elevated API access)
- Full outbound action types
