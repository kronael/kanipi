# JID Hierarchy

JIDs are structured paths using `/` as separator. The first segment is the
channel prefix, subsequent segments form a hierarchy from broad to narrow.

## Format

```
channel/scope/leaf
```

| Channel  | Flat (current)      | Hierarchical (threads)                |
| -------- | ------------------- | ------------------------------------- |
| telegram | `tg/chatid`         | `tg/chatid/threadid`                  |
| discord  | `discord/channelid` | `discord/serverid/channelid/threadid` |
| whatsapp | `wa/groupjid`       | (flat for now)                        |
| email    | `email/threadid`    | (flat for now)                        |
| web      | `web/slinkid`       | (flat for now)                        |

Flat JIDs (`tg/-100123456`, `discord/987654321`) remain valid — they are
the first N segments. No migration needed for channels that don't use
sub-hierarchy.

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
tg/-100123456/*                — all forum topics in a group
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
UPDATE chats SET jid = REPLACE(jid, ':', '/');
UPDATE messages SET chat_jid = REPLACE(chat_jid, ':', '/');
UPDATE registered_groups SET jid = REPLACE(jid, ':', '/');
UPDATE scheduled_tasks SET chat_jid = REPLACE(chat_jid, ':', '/');
```

`REPLACE(jid, ':', '/')` works because no channel ID contains `:`.
WhatsApp JIDs contain `@` but not `:`. Run in a transaction.

Code changes: search-replace `startsWith('tg:')` → `startsWith('tg/')`
etc. in all channel files. Systematic — one sed command worth of changes.

The `kanipi` CLI `group add` also needs updating (constructs JIDs).

## Channel responsibility

Each channel constructs its JIDs. Gateway only sees the string and
matches against registered groups via exact lookup or glob.

- **Discord** — `discord/<channelId>` for channels;
  `discord/<serverId>/<channelId>/<threadId>` for threads.
  Non-thread channels keep the flat form (backwards compatible with
  existing registrations). Thread JIDs add server+thread segments.
  `msg.channel.parentId` and `msg.guildId` available at runtime.
- **Telegram** — `tg/<chatId>` for plain chats;
  `tg/<chatId>/<messageThreadId>` for forum topics.
  `ctx.message.message_thread_id` available on inbound.
- **WhatsApp**, **email**, **web** — flat for now; extend when needed.

## `ownsJid()` update

Each channel matches its prefix:

```typescript
// before: jid.startsWith('tg:')
// after:
ownsJid(jid: string) { return jid.startsWith('tg/'); }
```

## Implementation plan

### Phase 1: separator migration (breaking, do first)

1. Add DB migration function — `REPLACE(':','/')` across all JID columns
2. Update all `ownsJid()` in channels — `startsWith('prefix/')`
3. Update JID construction in channels — `tg/${chatId}` etc.
4. Update `kanipi` CLI — `group add` JID validation
5. Update `email:` references in email.ts
6. Run migration on all instances, rebuild images

### Phase 2: hierarchy + glob (additive, safe after phase 1)

1. Add `minimatch` dependency (or `picomatch` — smaller, faster)
2. Replace exact `registeredGroups[chatJid]` lookup with `findGroup()`
3. Pre-compile glob patterns at group registration
4. Discord: emit `discord/<guildId>/<channelId>/<threadId>` for threads
5. Telegram: emit `tg/<chatId>/<threadId>` for forum topics
6. Document JID format in agent SKILL.md

## Open

- WhatsApp group JIDs contain `@g.us` suffix — cosmetically ugly in
  paths but harmless; no change needed
- Email threading uses `email_threads` table keyed by Message-ID, not
  by JID hierarchy — keep as-is, it's a different concern
