# Auth (v1) — password gate

Single shared password protects the web UI. Set `AUTH_SECRET` (JWT signing
key) and optionally `AUTH_PASSWORD` (defaults to `"password"`).

## How it works

- `GET /auth/login` — login page (server-rendered HTML, no JS framework)
- `POST /auth/login` — verify password → set 30d `refresh` HttpOnly cookie +
  return 1hr JWT in body
- `POST /auth/logout` — clear cookie + delete session from DB
- All non-public routes redirect to `/auth/login` when unauthenticated

## Config

| Env var         | Required | Description                               |
| --------------- | -------- | ----------------------------------------- |
| `AUTH_SECRET`   | yes      | JWT signing key (≥32 bytes); enables auth |
| `AUTH_PASSWORD` | no       | shared password (default: `password`)     |

Auth is disabled when `AUTH_SECRET` is unset.

## Implementation

`src/auth.ts` — `handleLoginPost`, `checkSessionCookie`, `handleLogout`,
`mintJwt`, `loginPageHtml`. Wired in `src/web-proxy.ts`.

Session stored in `auth_sessions` DB table (token SHA-256, 30d TTL).

## OAuth providers

Moved to `specs/v3/auth-oauth.md` — Telegram widget, Discord, GitHub, Google
via arctic. Not implemented in v1.
