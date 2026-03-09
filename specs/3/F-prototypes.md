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
router resolves target "main/support/user_123"
  → target doesn't exist
  → clone from "main/support" (the routing source)
  → register clone in DB
  → route to clone
```

No special prototype flag, no prototype column. The
group that holds the routing rule is the prototype by
convention. Any group can be a prototype.

## Spawns are just child directories

No special naming. Spawns are children in the existing
`/` hierarchy. The folder isolation already prevents
siblings from seeing each other:

```
main/support/                   prototype
main/support/tg_1112184352/     spawn (child)
main/support/web_abc123/        spawn (child)
main/reddit/                    prototype
main/reddit/post_abc123/        spawn (child)
```

Children can't see siblings. The prototype (parent)
can't see children's state. World boundaries already
enforce this. No new isolation mechanism needed.

## What gets copied

- CLAUDE.md, SOUL.md — copied
- Session, memory, workdir — NOT copied (fresh)
- DB state — new row, empty session
- skills/ — mounted read-only from prototype (not copied)

## Spawn limits

`max_children` on the prototype group (default: 50).
When reached, new targets route to the prototype
instead (fallback, not error). Prevents runaway from
config errors.

```typescript
// registered_groups
max_children?: number;  // default: 50, 0 = no spawning
```

## Filesystem

```
prototype/                 seeds root (was template/)
  env.example
  workspace/
  web/

groups/
  main/support/            prototype
    CLAUDE.md
    SOUL.md
    skills/
  main/support/tg_123/     spawn
    CLAUDE.md              copied from prototype
    SOUL.md                copied from prototype
    skills/                mounted ro from prototype
```

## Routing rules

Spawns inherit routing rules from the prototype. The
hierarchy is for session and data isolation — routing
is fixed by the prototype's config.

## Thread lifecycle

`Close` events from platforms (see `S-social-events.md`)
mark thread groups as closed. Closed groups don't accept
new messages — events route to the prototype instead.

## Retention and archival

Daily cleanup job removes inactive thread groups.

```typescript
// registered_groups
spawn_ttl_days?: number;     // delete after N days inactive (default: 7)
archive_closed_days?: number; // archive closed threads after N days (default: 1)
```

Three states:

- **active**: normal routing and processing
- **closed**: marked by Close event or inactivity. No new
  messages accepted, routes to prototype. Group folder
  preserved on disk for archival reads.
- **archived**: folder compressed and moved to
  `groups/{prototype}/archive/`. DB row removed. Agent
  can still read archived threads via skills if needed.

Cleanup runs once per day (existing scheduler loop):

1. Find thread groups with no messages in `spawn_ttl_days`
   → mark closed
2. Find closed groups older than `archive_closed_days`
   → compress folder, move to archive/, delete DB row

## Migrations

Spawns inherit the prototype's `MIGRATION_VERSION`. On
boot, if spawn version < prototype version, the agent
runs migrations from `skills/self/migrations/`.

New spawns get current prototype state. Existing spawns
don't auto-update — delete and re-create to refresh.

## Open

1. **Copy vs symlink** — full copy or symlink CLAUDE.md/
   SOUL.md from prototype? Copy is simpler, symlink
   keeps spawns in sync but breaks on prototype deletion.
