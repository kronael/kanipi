# Prototypes

**Status**: open. Core mechanism for group creation.
See `S-social-events.md` for social channel usage.

## Model

Every group is created from a prototype. A prototype is
just a group. The `template/` directory is renamed to
`prototype/` — it seeds the root group, which is the
only group not spawned from another group.

When the router resolves a target that doesn't exist,
the gateway clones it from the routing source group
(the group whose routing rule matched). The source IS
the prototype.

```
router resolves target "main/support~user_123"
  → target doesn't exist
  → clone from "main/support" (the routing source)
  → register clone in DB
  → route to clone
```

No special prototype flag, no prototype column. The
group that holds the routing rule is the prototype by
convention. Any group can be a prototype.

## What gets copied

- CLAUDE.md, SOUL.md, skills/ — copied
- Session, memory, workdir — NOT copied (fresh)
- DB state — new row, empty session

## Spawn naming

Convention: `{source}~{sanitized_id}`

Tilde separator (`~`): not `/` (avoids depth confusion),
not `:` (used in JIDs), filesystem-safe, visually distinct.
ID sanitized: replace `:` and `/` with `_`.

```
main/support                    source group (prototype)
main/support~tg_1112184352      spawned for telegram user
main/support~web_abc123         spawned for web user
main/reddit~post_abc123         spawned for reddit thread
```

Tilde doesn't change depth — spawns inherit tier of source.

## Spawn limits

`max_children` on the source group (default: 50).
When reached, new targets route to the source instead
(fallback, not error). Prevents runaway from config errors.

```typescript
// registered_groups
max_children?: number;  // default: 50, 0 = no spawning
```

## Lifecycle

- **Created**: router resolves non-existent target
- **Active**: normal group, own container, own state
- **Cleanup**: no messages in N days → remove
  (`spawn_ttl_days`, default: 7)

## Filesystem

```
prototype/                 seeds root (was template/)
  env.example
  workspace/
  web/

groups/
  main/support/            source group
    CLAUDE.md
    SOUL.md
    skills/
  main/support~tg_123/     spawn
    CLAUDE.md              copied from source
    SOUL.md                copied from source
    skills/                copied from source
```

## Update propagation

New spawns get current source state. Existing spawns are
isolated copies — not updated. To refresh: delete spawn,
next message creates fresh clone.

## Migration

Rename `template/` → `prototype/` in:

- Repo directory
- `src/cli.ts` references
- `CLAUDE.md` layout section
- Dockerfile COPY steps

## Open

1. **Copy mechanism** — full filesystem copy or symlink?
   Symlinks are lighter but break on source modification.
2. **Cross-spawn knowledge** — shared facts/ mount (ro)
   from source?
3. **Routing rule inheritance** — do spawns inherit the
   source's routing rules? Or terminal (no further routing)?
