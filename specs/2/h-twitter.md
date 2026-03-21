---
status: dropped
---

# Twitter/X channel

Inbound/outbound via `agent-twitter-client` (elizaOS scraper).
No API keys required -- uses cookie-based auth.

## Source and sink

- **Inbound**: polling mentions via search every 30s
- **Outbound**: tweet, reply, repost, like, follow
- Enabled by: `TWITTER_USERNAME` + `TWITTER_PASSWORD` + `TWITTER_EMAIL`

## JID format

`twitter:{userId}` for @mentions.

## Library

`agent-twitter-client` -- scraper-based client, no official API required.
Fork of @the-convocation/twitter-scraper with tweet sending support.

## Auth flow

1. First run: login with username + password + email
2. Cookies saved to `store/twitter-cookies.json`
3. Subsequent runs: load cookies, skip login
4. If cookies stale: re-login, refresh cookies

## Config

```env
TWITTER_USERNAME=...
TWITTER_PASSWORD=...
TWITTER_EMAIL=...
```

## V1 scope (current)

- Mentions via search polling (every 30s)
- Post, reply, like, retweet, follow
- Single bot account per instance

## Limitations

- No streaming (scraper doesn't support it)
- No DMs (scraper limitation)
- No unfollow/delete/profile updates
- Tweets over 280 chars may fail
- Rate limits depend on Twitter's anti-scraping measures
