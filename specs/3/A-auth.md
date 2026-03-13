---
status: shipped
---

# Auth

What ships today:

- local username/password login
- JWT access token minting
- refresh-token sessions in DB
- login/refresh/logout routes in `src/web-proxy.ts` + `src/auth.ts`
- slink JWT verification when `AUTH_SECRET` is set

What does not ship today:

- OAuth providers
- Telegram Login Widget auth
- provider callback routes

## Current routes

```text
GET  /auth/login
POST /auth/login
POST /auth/refresh
POST /auth/logout
```

## Token model

- Access token: HMAC-SHA256 JWT, 1h TTL, returned in JSON
- Refresh token: opaque random token, SHA-256 hash stored in `auth_sessions`
- Refresh rotation: old refresh token deleted, new one inserted

## Cookie behavior

Current code sets:

```text
Set-Cookie: refresh=<token>; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict
```

This is broader than the older spec draft that said `Path=/auth`.

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

## Current scope

Local auth is enabled when `AUTH_SECRET` is set.

Protected web routes use the session cookie check in the proxy. Public
widget routes under `/pub/` and `/_sloth/` bypass that check.

## Deferred to phase 4

- Discord OAuth
- GitHub OAuth
- Google OAuth / OIDC
- Telegram widget login
- Provider identity linking across channels
