---
status: shipped
---

# Auth

## What ships

- local username/password login (argon2 hashed)
- JWT access token minting (HMAC-SHA256, 1h TTL)
- refresh-token sessions in DB
- login/refresh/logout routes
- GitHub OAuth (code exchange + user info)
- Discord OAuth (code exchange + user info)
- Telegram Login Widget verification
- user management CLI (`kanipi config <instance> user {add|rm|list|passwd}`)
- login page with OAuth buttons (shown when providers configured)

## What was removed

- `SLOTH_USERS` env var and Basic auth — all web auth now goes through
  session cookies. `AUTH_SECRET` is required for non-public web mode.

## Routes

```text
GET  /auth/login              login page (shows OAuth buttons if configured)
POST /auth/login              local username/password login
POST /auth/refresh            rotate refresh token, mint new JWT
POST /auth/logout             clear session

GET  /auth/github             redirect to GitHub authorize
GET  /auth/github/callback    exchange code, create session, redirect /
GET  /auth/discord            redirect to Discord authorize
GET  /auth/discord/callback   exchange code, create session, redirect /
POST /auth/telegram           verify widget hash, create session
```

## Token model

- Access token: HMAC-SHA256 JWT, 1h TTL, returned in JSON
- Refresh token: opaque random token, SHA-256 hash stored in `auth_sessions`
- Refresh rotation: old refresh token deleted, new one inserted

## Cookie behavior

```text
Set-Cookie: refresh=<token>; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict
```

OAuth callbacks use `SameSite=Lax` to survive the redirect from the provider.

## DB tables

```sql
CREATE TABLE auth_users (
  id INTEGER PRIMARY KEY,
  sub TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## OAuth providers

### GitHub

Env vars: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`

Flow: `/auth/github` redirects to GitHub with state cookie. Callback
exchanges code for access token, fetches `/user`, creates local
`auth_users` entry with `sub=github:<id>`, `username=gh_<login>`.

### Discord

Env vars: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`

Flow: `/auth/discord` redirects to Discord with state cookie. Callback
exchanges code for access token, fetches `/users/@me`, creates local
`auth_users` entry with `sub=discord:<id>`, `username=dc_<username>`.

### Telegram

Uses `TELEGRAM_BOT_TOKEN` to verify the Login Widget hash (HMAC-SHA256).

POST `/auth/telegram` with widget data JSON. Server verifies
`auth_date` is within 24h, computes HMAC, creates local `auth_users`
entry with `sub=telegram:<id>`, `username=tg_<username>`.

## User management CLI

```bash
kanipi config <instance> user list
kanipi config <instance> user add <username> <password>
kanipi config <instance> user rm <username>
kanipi config <instance> user passwd <username> <password>
```

`user add` hashes with argon2, inserts with `sub=local:<uuid>`.
`user rm` deletes user and all their sessions.

## Auth mode

- `AUTH_SECRET` set: session cookie auth required for non-public routes
- `WEB_PUBLIC=1`: no auth, everything accessible
- Neither: no auth required (open access)
