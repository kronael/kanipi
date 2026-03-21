---
status: dropped
---

# Reddit channel

Reddit inbox (private messages + comment replies) as inbound/outbound.
Subreddit monitoring as optional source (v2).
Raw fetch with OAuth2 script app. Free under 100 req/min.

## Source and sink

- **Inbound**: poll inbox + subreddit /new, process unread
- **Outbound**: comment, post, vote, crosspost, subscribe
- Enabled by: `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` + credentials

## JID format

`reddit:{username}` for DMs/inbox.
`reddit:r_{subreddit}` for subreddit threads (v2).

## OAuth / app registration

App type: `script` (self-use, no user OAuth flow needed).
Register at reddit.com/prefs/apps → script app → get client_id + secret.
Use bot account credentials (username + password) directly in config.

## Library

Raw fetch with OAuth2 password grant. No wrapper library —
token refresh, rate limit retry, and API calls implemented directly.
User-Agent required by Reddit API policy.

## Rate limits

100 requests / minute (free). Client handles token refresh
and Retry-After headers. Poll inbox every 30s.

## Config

```env
REDDIT_CLIENT_ID=...
REDDIT_CLIENT_SECRET=...
REDDIT_USERNAME=bot_account
REDDIT_PASSWORD=...
```

## V1 scope (current)

- Inbox polling (DMs + comment replies)
- Post, reply, vote, crosspost, subscribe/unsubscribe, delete, edit
- One bot account per instance

## V2 scope (future)

- Subreddit new post monitoring (configurable list)
- Relevance scoring before routing to agent
- Config: `REDDIT_SUBREDDITS=r/claudeai,r/LocalLLaMA`
