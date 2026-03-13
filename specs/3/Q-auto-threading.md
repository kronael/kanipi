---
status: shipped
---

# Q: Template Routing (per-user routing)

## Problem

A group like `marinade/atlas` receives messages from many users. All hit
the same agent session, polluting context. Users want isolated threads
with per-user memory and conversation history.

## Design

Route targets support RFC 6570 Level 1 template expansion. A target
containing `{sender}` is expanded per-message to `<base>/<sender-file-id>`.
Non-existent targets are auto-created via `spawnGroupFromPrototype`.

### Layout

```
marinade/atlas/              routing hub (tier 1)
  prototype/                 seed files for auto-created children
  support/                   group conversation fallback (tier 2)
  tg-123456/                 per-user, auto-created (tier 2)
  wa-5551234@s.whatsapp.net/ per-user, auto-created (tier 2)
```

All children are siblings at the same tier. No sibling visibility.

### Routes

```
seq=0  type=default  target=atlas/{sender}
seq=1  type=default  target=atlas/support
```

## Template expansion

In `resolveRoute`, expand `{sender}` via `senderToUserFileId(msg.sender)`
before returning the target. Only variable for now.

```typescript
// router.ts
function expandTarget(target: string, msg: NewMessage): string | null {
  if (!target.includes('{')) return target;
  return target.replace('{sender}', senderToUserFileId(msg.sender));
}
```

Folder names use sender IDs as-is — no sanitization. `@`, `.` etc are
valid Unix filenames. If `mkdir` fails, fall through to next route.

## Route resolution at runtime

Replace static `jidToFolder` lookups with runtime DB queries that
expand templates per-message. `getRoutesForJid` + `resolveRoute` already
exist. The static map stays as cache for enumerating known JIDs.

## Auto-create

Reuses existing `spawnGroupFromPrototype`:

- Checks `max_children` on parent
- Copies from parent's `prototype/` directory
- Updates in-memory `groups` map + DB

If creation fails (max_children, no prototype dir, mkdir error),
`resolveRoute` returns null → falls through to next route (→ support).

## Code changes

| File                  | Change                                      | Size      |
| --------------------- | ------------------------------------------- | --------- |
| `src/router.ts`       | `expandTarget()` in `resolveRoute`          | ~5 lines  |
| `src/index.ts`        | runtime route resolution on hot path        | ~15 lines |
| `src/group-folder.ts` | relaxed validation (no charset restriction) | done      |

No schema changes. No new route types. No new config.

## Config

```bash
kanipi config marinade group add atlas
kanipi config marinade group add atlas/support
mkdir -p groups/atlas/prototype
cp groups/atlas/{SOUL.md,CLAUDE.md} groups/atlas/prototype/

kanipi config marinade route set <jid> \
  0:default:atlas/{sender} \
  1:default:atlas/support
```

`max_children` on hub caps total auto-created threads (default 50).

## Future

- TTL/LRU eviction of stale threads
- `{platform}`, `{chat}` template variables
