# Auth Specification

## Overview

HTTP auth layer for the kanipi web UI. Supports local accounts and OAuth
providers. Issues short-lived JWTs + long-lived HttpOnly refresh tokens.

---

## Identity Providers

Implemented via [arctic](https://arcticjs.dev) — lightweight OAuth2/OIDC
library with no framework dependency.

| Provider | Mechanism         | Sub prefix |
| -------- | ----------------- | ---------- |
| Local    | username + argon2 | `local:`   |
| Telegram | Login Widget      | `tg:`      |
| Discord  | OAuth2            | `discord:` |
| GitHub   | OAuth2            | `gh:`      |
| Google   | OAuth2 + OIDC     | `google:`  |

New providers: add an arctic adapter, register a route pair
(`/auth/<provider>` + `/auth/<provider>/callback`), no other changes.

---

## Token Model

**Access token** — JWT, 1hr TTL, stored in `localStorage`.

```json
{
  "sub": "tg:123456",
  "name": "Alice",
  "provider": "telegram",
  "exp": 1234567890
}
```

**Refresh token** — opaque random string, 30d TTL, stored as argon2 hash
in DB. Delivered via `Set-Cookie: refresh=<token>; HttpOnly; SameSite=Strict; Secure`.

**Rotation**: each `POST /auth/refresh` call invalidates the old refresh
token and issues a new one (one-time-use rotation).

**Auto-refresh**: client checks JWT expiry on page focus / before fetch.
When `exp - now < 5min`, silently calls `POST /auth/refresh`. On 401 →
redirect to `/auth/login`.

---

## Routes

```
GET  /auth/login                  login page (password form + OAuth buttons)
POST /auth/login                  verify local credentials → mint tokens
GET  /auth/<provider>             redirect to OAuth provider
GET  /auth/<provider>/callback    verify state + code → mint tokens
POST /auth/refresh                exchange refresh cookie → new JWT + new cookie
POST /auth/logout                 delete session row + clear cookie
```

### POST /auth/login

Request body (JSON or form):

```json
{ "username": "alice", "password": "hunter2" }
```

Response on success:

```json
{ "token": "<jwt>" }
```

Plus `Set-Cookie: refresh=<token>; HttpOnly; SameSite=Strict; Secure; Path=/auth`.

Rate limited: 5 attempts / 15 min per IP. Exceed → 429.

### GET /auth/<provider>

Generates state + PKCE verifier (where applicable), stores in server-side
session or signed cookie, redirects to provider authorization URL.

### GET /auth/<provider>/callback

Validates state. Exchanges code for tokens via arctic. Resolves or creates
user sub. Mints JWT + refresh token. Redirects to `/`.

### POST /auth/refresh

Reads `refresh` cookie. Looks up hash in `auth_sessions`. If valid and
not expired: delete row, insert new row, respond with new JWT + new cookie.
On any failure: clear cookie, return 401.

### POST /auth/logout

Deletes `auth_sessions` row for the presented refresh cookie hash.
Clears cookie. Returns 200.

---

## DB Schema

```sql
CREATE TABLE auth_users (
  id         INTEGER PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  hash       TEXT NOT NULL,           -- argon2id hash of password
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,        -- argon2id hash of refresh token
  user_sub   TEXT NOT NULL,           -- e.g. "tg:123456" or "local:1"
  expires_at TEXT NOT NULL,           -- ISO-8601
  created_at TEXT NOT NULL
);
```

No `auth_sessions` row for OAuth users on first login — sub is derived
from provider identity. A row is created on every refresh token issuance
regardless of provider.

---

## Security

- **Password hashing**: argon2id via `@node-rs/argon2`. Parameters: m=65536, t=3, p=4.
- **Refresh token storage**: SHA-256 of the raw token stored, raw token sent to client only.
  Actually use argon2id for storage — consistent with passwords.
- **JWT signing**: HS256, secret from `AUTH_SECRET` env var (min 32 bytes).
- **Cookie flags**: `HttpOnly; SameSite=Strict; Secure; Path=/auth`.
  `Path=/auth` limits cookie transmission to auth endpoints only.
- **State parameter**: cryptographically random, verified on callback.
- **Token rotation**: refresh tokens are single-use. Old token invalidated on
  each refresh.
- **Rate limiting**: in-memory sliding window on `POST /auth/login`. Keyed by
  `X-Forwarded-For` (first IP) or `req.socket.remoteAddress`.
- **Expiry sweep**: expired `auth_sessions` rows can be pruned on login or via
  a periodic task. No hard requirement — they are inert after `expires_at`.

---

## Config

| Env var                 | Required | Description                             |
| ----------------------- | -------- | --------------------------------------- |
| `AUTH_SECRET`           | yes      | JWT signing secret (≥32 bytes)          |
| `DISCORD_CLIENT_ID`     | no       | enables Discord OAuth                   |
| `DISCORD_CLIENT_SECRET` | no       |                                         |
| `GITHUB_CLIENT_ID`      | no       | enables GitHub OAuth                    |
| `GITHUB_CLIENT_SECRET`  | no       |                                         |
| `GOOGLE_CLIENT_ID`      | no       | enables Google OAuth                    |
| `GOOGLE_CLIENT_SECRET`  | no       |                                         |
| `AUTH_BASE_URL`         | no       | OAuth callback base (default: WEB_HOST) |

Telegram Login Widget requires no server secret beyond `AUTH_SECRET`.
Local auth is always enabled if `AUTH_SECRET` is set.

---

## Implementation Notes

- Auth routes live in `src/auth.ts`, exported as an Express router.
- `src/auth-middleware.ts` exports `requireAuth(req, res, next)` — verifies
  JWT from `Authorization: Bearer <token>` header. Used on non-public routes.
- Sloth public routes (`/pub/`) bypass auth middleware entirely.
- `arctic` is the only new dependency. `@node-rs/argon2` for hashing.
- JWT lib: `jose` (already likely present; zero-dep, ESM-native).
