# Group Permissions

**Status**: shipped

This spec documents the current permission model implemented in
the gateway. It also marks the still-missing pieces explicitly.

## Terminology

- **Tier 0**: root (instance admin)
- **Tier 1**: world (top-level folder)
- **Tier 2**: agent (group container)
- **Tier 3**: worker (subagent/sandboxed)

## Problem

Binary root/non-root was not enough. The gateway needs:

- an instance root with broad control
- top-level worlds isolated from one another
- deeper agent/worker groups with narrower permissions
- mount restrictions that reduce prompt-injection blast radius

## Current hierarchy

Four tiers derived from folder structure.

```text
main                    tier 0 — instance root
atlas                   tier 1 — world
atlas/support           tier 2 — agent
atlas/support/web       tier 3 — worker
```

`root` is the tier-0 folder name.

```typescript
function isRoot(folder: string): boolean {
  return folder === 'root';
}

function permissionTier(folder: string): 0 | 1 | 2 | 3 {
  if (isRoot(folder)) return 0;
  return Math.min(folder.split('/').length, 3) as 1 | 2 | 3;
}
```

Top-level non-root folders are worlds. Depth 2 is a normal agent.
Depth 3+ is clamped to worker.

## Tier semantics

### Tier 0: instance root

- Can call all existing gateway actions
- Can send to any registered JID
- Can schedule/pause/resume/cancel tasks for any registered group
- Can set routing rules for any registered group
- Can delegate to direct child groups
- Can escalate nothing upward
- Sees `/workspace/self/`

Important restriction now enforced:

- `register_group` via action cannot create a new top-level world
- new worlds are CLI-only

Tier 0 may still create child groups inside an existing world.

### Tier 1: world

- Scoped to its own world only
- Can send to any registered JID in the same world
- Can schedule and manage tasks in the same world
- Can create direct children in its own world
- Can set routing rules for direct children
- Cannot refresh group metadata globally
- Cannot see `/workspace/self/`

### Tier 2: agent

- Can send to its own registered JID only
- Can send files to its own registered JID only
- Can schedule/manage tasks for its own group only
- Can delegate to direct child groups
- Can escalate to its direct parent
- Cannot register groups
- Cannot set routing rules

### Tier 3: worker

- Read-mostly container mounts
- Can send text to its own registered JID only
- Cannot send files
- Cannot delegate to children
- Cannot schedule tasks
- Can escalate to its direct parent

## Existing authorization rules

### Messaging

`send_message`:

- tier 0: any target
- tier 1: any registered target in same world
- tier 2/3: only own group's registered JID

`send_file`:

- tier 0: any target
- tier 1: any registered target in same world
- tier 2: only own group's registered JID
- tier 3: denied

### Tasks

`schedule_task`, `pause_task`, `resume_task`, `cancel_task`:

- tier 0: any registered target/task
- tier 1: same world only
- tier 2: own group only
- tier 3: denied

### Group management

`register_group`:

- tier 0: allowed for child groups only, not new worlds
- tier 1: allowed for direct children in own world
- tier 2/3: denied

`set_routing_rules`:

- tier 0: any registered group
- tier 1: direct children in own world
- tier 2/3: denied

`delegate_group`:

- tier 0: any folder in any world (root world privilege)
- root/\* subgroups: any folder in any world (root world privilege)
- tier 1: any descendant in own subtree
- tier 2: any descendant in own subtree
- tier 3: denied

`escalate_group`:

- tier 2: direct parent only
- tier 3: direct parent only
- tier 0/1: denied

### Session and metadata

`reset_session`:

- all tiers allowed for their own current group context

`refresh_groups`:

- tier 0 only

## Current mount enforcement

The container runner enforces practical mount restrictions.

| Mount                     | Tier 0 | Tier 1 | Tier 2           | Tier 3           |
| ------------------------- | ------ | ------ | ---------------- | ---------------- |
| `/home/node`              | rw     | rw     | rw               | ro               |
| `/home/node/CLAUDE.md`    | —      | —      | ro overlay       | ro (from parent) |
| `/home/node/SOUL.md`      | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/CLAUDE.md`     | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/skills`        | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/settings.json` | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/output-styles` | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/projects`      | —      | —      | rw (from parent) | rw overlay       |
| `/home/node/media`        | —      | —      | rw (from parent) | rw overlay       |
| `/home/node/tmp`          | —      | —      | rw (from parent) | rw overlay       |
| `/workspace/share`        | rw     | rw     | ro               | ro               |
| `/workspace/ipc`          | rw     | rw     | rw               | rw               |
| `/workspace/web`          | rw     | rw     | no               | no               |

<!-- tier 2 and 3 have no filesystem access to /workspace/web; HTTP access is always available -->

| `/workspace/self` | ro | no | no | no |
| `~/groups` | rw | no | no | no |

## Agent env vars

The gateway injects these environment variables into every agent container:

| Variable                  | Value                              |
| ------------------------- | ---------------------------------- |
| `NANOCLAW_GROUP_NAME`     | display name of the group          |
| `NANOCLAW_GROUP_FOLDER`   | folder path (e.g. `atlas/support`) |
| `NANOCLAW_TIER`           | permission tier (0-3)              |
| `NANOCLAW_IS_ROOT`        | `"1"` if tier 0, absent otherwise  |
| `NANOCLAW_IS_WORLD_ADMIN` | `"1"` if tier 1, absent otherwise  |
| `NANOCLAW_ASSISTANT_NAME` | bot name from config               |
| `NANOCLAW_DELEGATE_DEPTH` | current delegation depth           |

## What shipped

- top-level worlds are no longer tier 0
- root aliases are explicit (`main`, `root`)
- root can no longer create new worlds through `register_group`
- upward escalation now exists as `escalate_group`

See `6-permissions-gaps.md` for remaining open items.
