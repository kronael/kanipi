# Cross-channel identity — open

Link a single user across multiple channels and auth providers.
Prerequisite: normalize all JIDs to compact URI format.

## Part 1: JID format normalization

### Current state

| Channel  | Chat JID format                           | Sender format  |
| -------- | ----------------------------------------- | -------------- |
| WhatsApp | `whatsapp:id@g.us` / `...@s.whatsapp.net` | bare phone     |
| Telegram | `telegram:chatid`                         | bare numeric   |
| Discord  | `discord:channelid`                       | bare snowflake |
| Email    | `email:threadhash`                        | bare address   |
| Web      | `web:folder`                              | `local:<uuid>` |

Problems: verbose prefixes, WhatsApp leaks transport suffixes,
sender has no platform prefix, group names not in message metadata.

### Target format

```
scheme:id            chat JID (where messages route)
scheme:~id#name      sender JID (who sent the message)
```

**Chat JIDs** (routing targets):

```
tg:-1001234567890           telegram group
tg:1112184352               telegram DM
wa:120363351541711945        whatsapp group (stripped @g.us)
wa:972501234567              whatsapp DM (stripped @s.whatsapp.net)
dc:1234567890                discord channel
em:a1b2c3d4e5f6              email thread
web:main                     web channel
```

No fragment on chat JIDs. Group name is metadata, injected via
XML attributes (see below).

**Sender JIDs** (message attribution):

```
tg:~1112184352#John          telegram user
wa:~972501234567#Mom         whatsapp user
dc:~9876543210#alice         discord user
em:~user@example.com#John   email sender
```

`~` prefix distinguishes sender from chat. `#name` is a cached
display name, updated when the platform reports a change.

**Parsing**: split on `:` → scheme, rest. `~` prefix → sender.
Split on `#` → id, display_name. One function:
`parseJid(jid) → { scheme, id, name?, isSender }`.

### Group name in message XML

Group names go into the `<message>` XML as a `group` attribute,
alongside existing `platform` and `sender`:

```xml
<message sender="tg:~1112184352#John" platform="tg" group="Support" time="...">
  Hello
</message>
```

Source: `chats.name` column (already in DB). Injected by
`formatMessages()` when the chat is a group (`is_group=1`).

### JID migration

Prefix mapping:

| Old         | New    |
| ----------- | ------ |
| `whatsapp:` | `wa:`  |
| `telegram:` | `tg:`  |
| `discord:`  | `dc:`  |
| `email:`    | `em:`  |
| `web:`      | `web:` |

WhatsApp suffix stripping: `@g.us` → removed,
`@s.whatsapp.net` → removed, `@lid` → translate first then strip.

DB migration updates `chats.jid`, `messages.chat_jid`,
`messages.sender` (add `~` prefix), `routes.jid`.

Code changes: `platformFromJid()` (works as-is, shorter prefixes),
`ownsJid()` per channel, `bareJid()` simplification, channel
constructors emit new format, `formatMessages()` adds group attr.

## Part 2: Identity linking

A canonical identity links multiple subs (sender JIDs) belonging
to the same person:

```sql
CREATE TABLE identities (
  id          TEXT PRIMARY KEY,   -- uuid4, the canonical user id
  name        TEXT NOT NULL,      -- display name (last seen)
  created_at  TEXT NOT NULL
);

CREATE TABLE identity_claims (
  sub         TEXT PRIMARY KEY,   -- e.g. "tg:~123456", "local:<uuid>"
  identity_id TEXT NOT NULL REFERENCES identities(id),
  claimed_at  TEXT NOT NULL
);
```

`sender` in messages stays the original sub. Gateway resolves
`identity_id` for context injection if needed.

### Claiming

A user links a new sub to their canonical identity by:

1. Being authenticated (holding a valid JWT with an existing sub).
2. Completing auth for the new provider (OAuth flow or password login).
3. Gateway merges the new sub into the existing identity record.

### In-group claim

A user can claim their web identity inside a channel group by
sending a one-time code:

1. `/auth/link-code` → returns a short-lived code (e.g. `LINK-ABCD`, 10min).
2. User sends the code in Telegram/Discord/WhatsApp.
3. Gateway matches code → links the channel sender to the JWT sub.

This bridges `local:<uuid>` (web password login) to `tg:~123456`
(Telegram sender) without requiring OAuth.

### Scope

- Identity resolution is advisory — agents can query it but does not
  enforce automatically.
- No identity merging UI (CLI only via `kanipi identity list/link/unlink`).
- Conflict resolution (two identities claim the same sub): last-write wins,
  log warning.

## Current state (2026-03-04)

Auth (`src/auth.ts`) is shipped: local accounts, argon2id, JWT, refresh cookie.
`auth_users.sub` is `local:<uuid>` — already a valid claim sub in this model.

**What exists:**

- `auth_users` + `auth_sessions` tables in `db.ts`
- `messages.sender` stores raw channel sender per message

**What is missing:**

- JID format normalization (Part 1)
- `identities` + `identity_claims` tables (Part 2)
- `GET /auth/link-code` endpoint
- Link-code detection in channel message handlers
- `kanipi identity` CLI subcommands

**Minimal path:** JID normalization first (Part 1), then in-group
claim flow (Part 2). No OAuth needed for Part 2.
