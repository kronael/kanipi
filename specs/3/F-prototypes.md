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

Shared files across spawns use the skills/ directory,
mounted read-only from the prototype. This is the
mechanism for cross-spawn knowledge — shared config,
facts, or tools go in skills/.

## Thread lifecycle

Spawned thread groups have lifecycle events from the
platform. These map to the `Close` verb in InboundEvent
(see `S-social-events.md`).

Platform close/lock signals:

| Platform | Signal                   | How                    |
| -------- | ------------------------ | ---------------------- |
| Discord  | thread archived/locked   | `THREAD_UPDATE` event  |
| Reddit   | post locked by moderator | `locked: true` on post |
| YouTube  | live stream ends         | stream status event    |
| Twitch   | stream goes offline      | offline event          |
| Mastodon | no close concept         | —                      |
| Bluesky  | no close concept         | —                      |
| Twitter  | reply restrictions set   | reply settings change  |
| Facebook | comments disabled        | comment setting change |

When a `Close` event arrives for a thread group, the
gateway marks the group as closed in the DB. Closed
groups don't accept new messages — events route to the
prototype instead.

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

The existing migration system extends naturally. When a
prototype is updated, spawns don't auto-update — but the
migration runner detects version drift on boot:

1. Prototype has `MIGRATION_VERSION=N`
2. Spawn was created at version M (stored in spawn dir)
3. On boot, agent sees `M < N`, runs migrations M+1..N
   from the prototype's skills/self/migrations/

Same mechanism agents already use. No new code path.

## Update propagation

New spawns get current prototype state. Existing spawns
are isolated copies — not updated. To refresh: delete
spawn, next message creates fresh clone.

## Repo migration

Rename `template/` → `prototype/` in:

- Repo directory
- `src/cli.ts` references
- `CLAUDE.md` layout section
- Dockerfile COPY steps

## Open

1. **Copy vs symlink** — full copy or symlink CLAUDE.md/
   SOUL.md from prototype? Copy is simpler, symlink
   keeps spawns in sync but breaks on prototype deletion.
