---
status: shipped
---

# Facebook Page channel

Inbound/outbound via Graph API raw fetch. Page Access Token auth.
No app review needed for page-scoped tokens.

## Source and sink

- **Inbound**: poll page feed every 30s, skip own posts
- **Outbound**: post, reply (comment), react, delete, edit, ban/unban, hide
- Enabled by: `FACEBOOK_PAGE_ID` + `FACEBOOK_PAGE_ACCESS_TOKEN`

## JID format

`facebook:{pageId}`

## Library

Raw fetch against Graph API (v21.0 default). No SDK — page token
in query params, JSON responses.

## Auth flow

1. Create Facebook App → get page access token (long-lived)
2. Token + page ID in .env, no login flow needed
3. Page access tokens don't expire if generated correctly

## Config

```env
FACEBOOK_PAGE_ID=...
FACEBOOK_PAGE_ACCESS_TOKEN=...
```

## V1 scope (current)

- Page feed polling (posts from others on the page)
- Post, reply, react (with type), delete, edit, ban/unban, hide
- Single page per instance

## V2 scope (future)

- Webhook-based inbound (real-time, requires public URL)
- Messenger DM support (requires app review)
- Instagram cross-posting via same Graph API
