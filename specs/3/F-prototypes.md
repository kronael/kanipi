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

## Routing rule inheritance

Spawns do NOT inherit routing rules from the prototype.
Spawns are terminal — they handle messages, they don't
route further. The prototype constrains the spawn: it
defines the setup, not the behavior tree.

Shared files across spawns use the `skills/` directory.
Skills are already mounted read-only from the prototype
into spawns. This is the mechanism for cross-spawn
knowledge — put shared config, facts, or tools in skills.

## Migrations

The existing migration system (`container/skills/self/
migrations/`) extends naturally to prototypes. When a
prototype is updated (new CLAUDE.md, new skills), spawns
don't auto-update — but the migration runner in the
agent container can detect version drift:

1. Prototype has `MIGRATION_VERSION=N`
2. Spawn was created at version M (stored in spawn dir)
3. On spawn boot, agent sees `M < N`, runs migrations
   M+1..N from the prototype's `skills/self/migrations/`

This reuses the exact same migration pattern agents
already run on session start. No new mechanism.

## Open

1. **Copy mechanism** — full filesystem copy or symlink?
   Symlinks are lighter but break on source modification.
2. **Skills mount** — mount prototype's skills/ read-only
   into spawns, or copy? Mount keeps spawns in sync but
   requires the prototype to stay on disk.
