# Auth (v1) — local accounts — shipped

HTTP auth for the web UI. Local accounts with argon2id passwords managed
via CLI. Issues short-lived JWTs + long-lived HttpOnly refresh tokens.

## Implemented routes

```
GET  /auth/login    login page (server-rendered HTML)
POST /auth/login    verify password → JWT + refresh cookie
POST /auth/refresh  rotate refresh cookie → new JWT + new cookie
POST /auth/logout   clear cookie + delete session
```

## Token model

- **JWT** — HS256, 1hr TTL, `{ sub, name, exp }`, stored in `localStorage`
- **Refresh token** — 32 random bytes, 30d TTL, HttpOnly cookie. SHA-256
  stored in `auth_sessions`. Rotated on every `/auth/refresh` call.

## User management (CLI)

```bash
kanipi config <instance> user list
kanipi config <instance> user add <username> <password>
kanipi config <instance> user passwd <username> <password>
kanipi config <instance> user rm <username>
```

## Config

| Env var       | Required | Description                        |
| ------------- | -------- | ---------------------------------- |
| `AUTH_SECRET` | yes      | JWT signing key; enables auth gate |

Auth disabled when `AUTH_SECRET` unset.

## DB schema

```sql
CREATE TABLE auth_users (
  id INTEGER PRIMARY KEY,
  sub TEXT UNIQUE NOT NULL,      -- "local:<uuid4>"
  username TEXT UNIQUE NOT NULL,
  hash TEXT NOT NULL,            -- argon2id
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,   -- SHA-256 of refresh token
  user_sub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## Implementation

`src/auth.ts` — `handleLoginPost`, `handleRefresh`, `handleLogout`,
`checkSessionCookie`, `mintJwt`, `loginPageHtml`. Wired in `src/web-proxy.ts`.

## OAuth providers

Out of scope for v1. See `specs/v3/auth-oauth.md` — Telegram widget,
Discord, GitHub, Google via arctic.
