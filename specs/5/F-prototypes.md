---
status: planned
---

# Prototypes

See `S-social-events.md` for social channel usage.

## Model

A group's `prototype/` subdirectory defines what its
children look like. When a child is spawned, the
parent's `prototype/` contents are copied into the new
child folder.

```
groups/root/prototype/         → what new worlds look like
groups/atlas/prototype/        → what atlas children look like
groups/atlas/support/prototype/→ what support children look like
```

When the router resolves a target that doesn't exist,
`spawnGroupFromPrototype` copies from the parent's
`prototype/` dir, registers the child in DB, and routes
to it.

```
router resolves target "main/support/user_123"
  → target doesn't exist
  → copy from "main/support/prototype/"
  → register child in DB
  → route to child
```

No special prototype flag, no prototype column. Any
group with a `prototype/` subdirectory can spawn
children.

## Spawns are just child directories

No special naming. Spawns are children in the existing
`/` hierarchy. The folder isolation already prevents
siblings from seeing each other:

```
main/support/                   parent (has prototype/)
main/support/tg_1112184352/     spawn (child)
main/support/web_abc123/        spawn (child)
main/reddit/                    parent (has prototype/)
main/reddit/post_abc123/        spawn (child)
```

Children can't see siblings. The parent can't see
children's state. World boundaries already enforce
this. No new isolation mechanism needed.

## What gets copied

- CLAUDE.md, SOUL.md — full copy (not symlink). SOUL.md lives
  at group root (`/home/node/SOUL.md`), read directly by agent.
  Spawns are independent once created.
- Session, memory, workdir — NOT copied (fresh)
- DB state — new row, empty session
- skills/ — mounted read-only from parent (not copied)

## Spawn limits

`max_children` on the parent group (default: 50).
When reached, new targets fall through to the next
route (fallback, not error). Prevents runaway from
config errors.

```typescript
// registered_groups
max_children?: number;  // default: 50, 0 = no spawning
```

## Filesystem

```
groups/
  root/
    prototype/             what new worlds look like
      CLAUDE.md
      SOUL.md
  main/
    support/               parent group
      prototype/           what support children look like
        CLAUDE.md
        SOUL.md
      tg_123/              spawn (child)
        CLAUDE.md          copied from support/prototype/
        SOUL.md            copied from support/prototype/
        skills/            mounted ro from parent
```

The repo-root `prototype/` directory seeds
`groups/root/prototype/` on `kanipi create`. It is
the initial definition of what new worlds look like.

## Routing rules

Spawns inherit routing rules from the parent. The
hierarchy is for session and data isolation — routing
is fixed by the parent's config.

## Thread lifecycle

`Close` events from platforms (see `S-social-events.md`)
mark thread groups as closed. Closed groups don't accept
new messages — events fall through to the next route.

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
  messages accepted, falls through to next route. Group folder
  preserved on disk for archival reads.
- **archived**: folder compressed and moved to
  `groups/{parent}/archive/`. DB row removed. Agent
  can still read archived threads via skills if needed.

Cleanup runs once per day (existing scheduler loop):

1. Find thread groups with no messages in `spawn_ttl_days`
   → mark closed
2. Find closed groups older than `archive_closed_days`
   → compress folder, move to archive/, delete DB row

## Migrations

Spawns inherit the parent's `MIGRATION_VERSION`. On
boot, if spawn version < parent version, the agent
runs migrations from `skills/self/migrations/`.

New spawns get current parent state. Existing spawns
don't auto-update — delete and re-create to refresh.

## Spawn folder naming

Derived from the triggering event's JID. The folder name
is the JID with `:` replaced by `_` and special chars
stripped:

```
mastodon:instance.social:12345  → mastodon_instance_social_12345
reddit:r_programming:post_abc   → reddit_r_programming_post_abc
tg:-100123456                   → tg_100123456
```

Function: `spawnFolderName(jid: string): string` in
`src/router.ts`.

## Cleanup job wiring

Registered as a system cron task in `src/task-scheduler.ts`
on startup (not in DB — hardcoded):

```typescript
// In startScheduler(), alongside existing system tasks
registerSystemTask({
  id: 'spawn-cleanup',
  cron: '0 3 * * *', // daily at 3am
  handler: cleanupSpawns,
});
```

## Scope

This milestone: router clone-on-missing, spawn folder
creation, max_children limit, DB registration. Thread
lifecycle (Close events) and retention/archival are
deferred until social channels land.

## Acceptance criteria

1. `spawnGroupFromPrototype` copies parent's `prototype/` to child
2. CLAUDE.md, SOUL.md copied from `prototype/` to spawn
3. skills/ mounted read-only from parent in container-runner
4. max_children limit enforced, fallback to next route
5. `spawnFolderName()` generates valid folder names from JIDs
6. All existing tests pass
