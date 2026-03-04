# Slink Specification — shipped

## What it is

A slink (sloth link) is the web channel for a kanipi group. Enabled the
same way as Telegram or Discord — by registering a `web:<name>` group.
The gateway generates a public token at registration time; that token is
the channel's POST endpoint.

```
POST /pub/s/<token>   →  delivers to the web group's agent
```

---

## Setup

```bash
kanipi group add web:main       # registers group, generates slink token
kanipi group add web:support    # multiple web groups per instance ok
```

Same pattern as:

```bash
kanipi group add tg:-100123456
kanipi group add discord:123456
```

The slink token is generated once at registration, stored on the group
row, never rotated. It is intentionally public — embedded in web pages.
Security comes from rate limiting, not token secrecy.

---

## Token

- 16-char random, URL-safe (96 bits)
- Public — freely shared in page source
- Routes POST to the correct group agent
- Stored in `registered_groups` row (new `slink_token` column)

---

## POST

```
POST /pub/s/<token>
Authorization: Bearer <jwt>   (optional)
Content-Type: application/json

{ "text": "..." }
```

Responses:

```
200  { "ok": true }
404  { "error": "not found" }
429  { "error": "rate limited" }
```

Returns immediately. Gateway delivers as `onMessage(group, { sender,
sender_name, content })` and returns. Caller does not wait for agent reply.

`sender` — JWT `sub` if present, otherwise `anon_<ip-hash>`
`sender_name` — JWT `name` claim if present, otherwise omitted

---

## Rate Limiting

| Caller              | Bucket           | Limit                              |
| ------------------- | ---------------- | ---------------------------------- |
| Anonymous (no JWT)  | shared per token | 10 req/min across all anon callers |
| Authenticated (JWT) | per JWT sub      | 60 req/min                         |
| Agent / operator    | —                | unlimited                          |

`sloth.js` attaches `Authorization: Bearer <jwt>` automatically if a
valid JWT exists in `localStorage` (from `specs/v1/auth.md`).
Anonymous callers share one pool so spam from many IPs stays bounded.

Thresholds configurable via `SLINK_ANON_RPM` / `SLINK_AUTH_RPM` env vars.

---

## DB

```sql
ALTER TABLE registered_groups ADD COLUMN slink_token TEXT;
-- populated at group registration for web: groups
```

No separate table. Token lives on the group row.

---

## Agent

The agent receives slink POSTs as normal inbound messages on the
`web:<name>` chat_jid. No special handling — same queue, same
`runContainerAgent` call as any other channel.

Agent knows its own slink URL via env vars injected at container start:

- `SLINK_TOKEN` — the raw token
- `WEB_HOST` — the public host, for constructing the full URL

---

## Gateway Routes

```
POST /pub/s/:token     deliver to group agent
GET  /pub/sloth.js     client script (see sloth spec)
```

---

## Related

- `specs/v1/auth.md` — JWT issuance for authenticated web users
- `specs/v1/sloth.md` — how agents use slinks to build living pages (TBD)
