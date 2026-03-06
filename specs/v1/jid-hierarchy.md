# JID Hierarchy

JIDs are structured paths using `/` as separator. The first segment is the
channel prefix, subsequent segments form a hierarchy from broad to narrow.

## Format

```
channel/world/room/thread
```

Not every channel has all levels. The path is as deep as the platform's
hierarchy goes. "World" is the outermost grouping (Discord guild, email
domain); "room" is a single conversation space; "thread" is a sub-conversation.

| Channel  | Flat (current)      | With world                  | With thread                          |
| -------- | ------------------- | --------------------------- | ------------------------------------ |
| telegram | `telegram/chatid`   | —                           | `telegram/chatid/threadid`           |
| discord  | `discord/channelid` | `discord/guildid/channelid` | `discord/guildid/channelid/threadid` |
| whatsapp | `whatsapp/groupjid` | —                           | (flat for now)                       |
| email    | `email/threadid`    | `email/domain/threadid`     | (flat for now)                       |
| web      | `web/slinkid`       | —                           | (flat for now)                       |

The JID path IS the hierarchy — no separate World/Room entities needed.
A world-scoped query is just a glob or prefix match on the JID:
`discord/guildid/*` matches all channels and threads in that guild.

Flat JIDs (`telegram/-100123456`, `discord/987654321`) remain valid —
they are the shortest form. Channels add segments as hierarchy becomes
available.
No migration needed for channels that don't use sub-hierarchy.

## Why `/` not `:`

- Standard path-glob libraries understand `/` natively — no custom
  separator config needed
- `:` was already the prefix separator, creating ambiguity on where
  prefix ends and hierarchy begins (`discord:serverid:channelid` — is
  `serverid` part of the prefix or the first hierarchy level?)
- Channel IDs from Discord/Telegram/WhatsApp never contain `/`
- Familiar mental model: JIDs are paths, groups are mount points

## Glob routing

`registered_groups.jid` may be a glob pattern:

```
discord/serverid/channelid/*   — all threads under a channel
discord/serverid/*             — all channels in a server
telegram/-100123456/*          — all forum topics in a group
```

Group lookup becomes a glob match against inbound JID. Most specific
match wins (longest literal prefix). Pre-compile patterns at registration
time — never run raw minimatch per message.

### Match algorithm

```typescript
function findGroup(
  jid: string,
  groups: Record<string, RegisteredGroup>,
): [string, RegisteredGroup] | undefined {
  // Exact match first (O(1) — covers all flat JIDs)
  if (groups[jid]) return [jid, groups[jid]];
  // Glob match (only for registered glob patterns)
  let best: [string, RegisteredGroup] | undefined;
  let bestLen = -1;
  for (const [pat, g] of Object.entries(groups)) {
    if (!pat.includes('*')) continue;
    if (minimatch(jid, pat) && pat.length > bestLen) {
      best = [pat, g];
      bestLen = pat.length;
    }
  }
  return best;
}
```

Exact match is the fast path — 99% of lookups. Glob iteration only runs
when exact misses AND glob patterns exist. Cache compiled minimatch
instances at registration time.

## Migration from `:` to `/`

One-time DB migration: replace first `:` with `/` in all JID columns.

Tables affected:

- `chats.jid` (PK)
- `messages.chat_jid` (FK + composite PK)
- `registered_groups.jid` (PK)
- `scheduled_tasks.chat_jid`

```sql
-- Expand short prefixes and switch separator in one pass
-- Order matters: replace prefix first, then remaining ':'
UPDATE chats SET jid =
  REPLACE(REPLACE(REPLACE(jid, 'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
UPDATE messages SET chat_jid =
  REPLACE(REPLACE(REPLACE(chat_jid, 'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
UPDATE registered_groups SET jid =
  REPLACE(REPLACE(REPLACE(jid, 'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
UPDATE scheduled_tasks SET chat_jid =
  REPLACE(REPLACE(REPLACE(chat_jid, 'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
```

The nested REPLACE handles both prefix expansion (`tg:` → `telegram/`,
`wa:` → `whatsapp/`) and separator change (`discord:` → `discord/`,
`email:` → `email/`, `web:` → `web/`). Channel IDs never contain `:`.
Run in a transaction.

Code changes: search-replace `startsWith('tg:')` → `startsWith('telegram/')`
etc. in all channel files. Systematic — one sed command worth of changes.

The `kanipi` CLI `group add` also needs updating (constructs JIDs).

## Channel responsibility

Each channel constructs its JIDs. Gateway only sees the string and
matches against registered groups via exact lookup or glob.

- **Discord** — always includes guild:
  `discord/<guildId>/<channelId>` for channels;
  `discord/<guildId>/<channelId>/<threadId>` for threads.
  `msg.guildId` and `msg.channel.parentId` available at runtime.
  DMs (no guild): `discord/dm/<channelId>`.
- **Telegram** — `telegram/<chatId>` for plain chats;
  `telegram/<chatId>/<messageThreadId>` for forum topics.
  `ctx.message.message_thread_id` available on inbound.
  No world segment — Telegram has no server/guild concept.
- **Email** — `email/<domain>/<threadId>` when domain extraction
  is trivial; `email/<threadId>` as fallback. Domain = world.
- **WhatsApp** — `whatsapp/<groupJid>` for groups;
  `whatsapp/<phoneJid>` for DMs. Flat for now.
- **Web** — `web/<slinkId>`. Flat for now.

## `ownsJid()` update

Each channel matches its prefix:

```typescript
// before: jid.startsWith('tg:')
// after:
ownsJid(jid: string) { return jid.startsWith('telegram/'); }
```

## Implementation plan

### Phase 1: separator migration (breaking, do first)

1. Add DB migration function — `REPLACE(':','/')` across all JID columns
2. Update all `ownsJid()` in channels — `startsWith('telegram/')` etc.
3. Update JID construction — `telegram/${chatId}`, `whatsapp/${jid}` etc.
4. Update `kanipi` CLI — `group add` JID validation
5. Update `email:` references in email.ts
6. Run migration on all instances, rebuild images

### Phase 2: worlds — expand Discord + email JIDs

1. Discord: emit `discord/<guildId>/<channelId>` (always include guild)
2. Discord DMs: `discord/dm/<channelId>`
3. Email: emit `email/<domain>/<threadId>`
4. Migrate existing flat Discord JIDs:
   `discord/<channelId>` → `discord/<guildId>/<channelId>`
   (requires one-time lookup of guild for each registered channel)

### Phase 3: hierarchy + glob (additive, safe after phase 2)

1. Add `picomatch` dependency (smaller/faster than minimatch)
2. Replace exact `registeredGroups[chatJid]` lookup with `findGroup()`
3. Pre-compile glob patterns at group registration
4. Discord threads: `discord/<guildId>/<channelId>/<threadId>`
5. Telegram forum topics: `telegram/<chatId>/<threadId>`
6. Document JID format in agent SKILL.md

## Open

- WhatsApp group JIDs contain `@g.us` suffix — cosmetically ugly in
  paths but harmless; no change needed
- Email threading uses `email_threads` table keyed by Message-ID, not
  by JID hierarchy — keep as-is, it's a different concern
