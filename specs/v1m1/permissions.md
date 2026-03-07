# Group Permissions

**Status**: not started

## Problem

Binary root/non-root is insufficient. Need:

- Public agents that can't modify their own setup
- Subgroups with specific capabilities
- CLI ops available to agents with proper access control
- DB never directly accessible by agents (already true)

## Hierarchy

Four tiers. Max 3 levels of nesting.

```
root                     tier 0 — root (god mode)
├── atlas/               tier 1 — world (isolated)
│   ├── atlas/support    tier 2 — agent (rw workdir)
│   └── atlas/support/web tier 3 — worker (restricted)
├── yonder/              tier 1 — world (isolated)
│   └── yonder/web       tier 2 — agent
└── (no world needed)    tier 0 alone works for simple setups
```

### Tier 0: root

The admin. Folder name: `root` (rename from current `main` —
see codebase changes below). One per instance.

- Sees all worlds, all groups, all messages
- Can modify gateway code (staging area, not direct)
- All IPC actions, no world boundary
- rw everything
- If you don't need structure, root alone is sufficient

### Tier 1: world

Top-level group. Isolated namespace. Sees only what's below.
Unrestricted write access to own group — but no access to
gateway source, agent runner, or plugin code.

- All IPC actions scoped to own world
- Can create children (register_group within own world)
- Can set routing_rules for own children
- send_message to any JID registered in own world
- rw own group folder, CLAUDE.md, skills
- Cannot see other worlds
- Cannot see root's data
- Cannot see /workspace/self/ (gateway/agent source)

### Tier 2: agent

The standard agent. Can do real work but can't modify its setup.

- rw own group workdir, ro CLAUDE.md/skills (see write levels)
- send_message/send_file to own JID
- delegate to own children
- schedule tasks for own group
- escalate to parent (upward delegation)

### Tier 3: worker

Restricted leaf node. Does specific tasks, minimal permissions.

- ro everything
- send_message only
- escalate to parent only
- no delegation, no scheduling

```typescript
function permissionTier(folder: string): 0 | 1 | 2 | 3 {
  if (folder === 'root') return 0;
  const depth = folder.split('/').length;
  return Math.min(depth, 3) as 1 | 2 | 3;
}
```

Tier is implied by folder depth: depth 1 = world, depth 2 = agent,
depth 3 = worker. No explicit config needed — structure is permission.

## World creation

- **CLI only** — agents cannot create new worlds
- Root agent can create children of existing worlds
- World agents can create children within own world
- Tier 2 agents and tier 3 workers cannot create groups

```
register_group authorization:
  tier 0: can create anything except new worlds (CLI only)
  tier 1: can create children in own world
  tier 2: cannot create groups
  tier 3: cannot create groups
  CLI:    unrestricted
```

**Worlds are CLI only**. Root can create children of worlds
but not new worlds. Worlds are infrastructure.

## Message visibility

Hierarchical: you see messages routed to you and below you.
You never see above or beside.

```
root          sees all messages in all worlds
atlas/        sees messages routed to atlas/ and atlas/*
atlas/support sees only messages routed to atlas/support
yonder/       sees messages routed to yonder/ and yonder/*
              does NOT see atlas/ messages
```

Rule: a group sees messages for its own JIDs plus all
descendant JIDs. Never ancestors, never siblings.

## Write levels

Two levels, configured per group. Default: workdir.

**unrestricted** — rw everything in group mount (CLAUDE.md,
skills, memory, workdir). Used by root and world. World is
unrestricted within own group but has no access to gateway
source or agent/plugin code (only root sees /workspace/self/).

**workdir** — rw group workdir only, ro CLAUDE.md/skills/setup.
Agent can write notes, memory, working files. Cannot modify
its own instructions or skills. Default for tier 2 agents.

Tier 3 workers get ro on everything (no writes at all).

This is sufficient because:

- Setup is concentrated in CLAUDE.md (global + group level)
- Agent can't rewrite its own instructions
- Prompt injection blast radius is limited to workdir
- Prototype pattern isolates per-JID state further
  (see specs/v2m1/prototypes.md)

## Prototypes

Per-JID group spawning from templates. Separate spec:
specs/v2m1/prototypes.md

## Escalation (upward delegation)

Tier 2 agents and tier 3 workers can ask their parent for
help. Inverse of `delegate_group`.

```
user → atlas/support (restricted, searches facts)
         → escalate to atlas/ (world, runs deep research)
              → returns findings
         → presents answer to user
```

- Only to direct parent (one level up)
- Parent receives structured request
- Parent returns findings via IPC reply
- Separate spec: specs/v2m1/escalation.md

## IPC actions by tier

| Action              | Tier 0 (root) | Tier 1 (world) | Tier 2 (agent) | Tier 3 (worker) |
| ------------------- | ------------- | -------------- | -------------- | --------------- |
| send_message        | any           | own world      | own JID        | own JID         |
| send_file           | any           | own world      | own JID        | no              |
| schedule_task       | any           | own world      | own group      | no              |
| pause/resume/cancel | any           | own world      | own group      | no              |
| register_group      | yes\*         | own children   | no             | no              |
| set_routing_rules   | yes           | own children   | no             | no              |
| delegate_group      | yes           | own children   | own children   | no              |
| escalate            | n/a           | n/a            | to parent      | to parent       |
| refresh_groups      | yes           | no             | no             | no              |
| reset_session       | yes           | yes            | yes            | yes             |
| list_actions        | yes           | yes            | yes            | yes             |

\*root cannot create worlds (CLI only), but can create world children

## Container mount enforcement

Write level determines mount mode. "workdir" means the group's
working directory is rw but setup files (CLAUDE.md, skills) are ro.

| Mount                     | Tier 0 (root) | Tier 1 (world) | Tier 2 (agent)       | Tier 3 (worker) |
| ------------------------- | ------------- | -------------- | -------------------- | --------------- |
| /workspace/group/         | rw            | rw             | workdir=rw, setup=ro | ro              |
| /home/node/.claude/       | rw            | rw             | rw                   | ro              |
| /workspace/self/          | ro            | no             | no                   | no              |
| /workspace/data/sessions/ | rw            | no             | no                   | no              |
| /workspace/share/         | rw            | rw             | ro                   | ro              |
| /workspace/ipc/           | rw            | rw             | rw                   | rw (limited)    |
| /workspace/media/         | rw            | rw             | rw                   | ro              |
| /workspace/web/           | rw            | rw             | no                   | no              |
| /app/src (agent-runner)   | rw            | rw             | rw                   | ro              |

Note: currently `/workspace/self/` is mounted ro for ALL groups.
This spec restricts it to root only. `/workspace/media/` and
`/workspace/web/` are currently rw for all — tier scoping is new.

## Codebase rename: main → root

`isRoot()` currently checks `!folder.includes('/')`. This
conflates "root group" with "any top-level folder". New model:

```typescript
// Tier 0: exactly "root"
function isInstanceRoot(folder: string): boolean {
  return folder === 'root';
}

// Tier 1: top-level but not "root"
function isWorld(folder: string): boolean {
  return !folder.includes('/') && folder !== 'root';
}

// Tier from folder depth
function permissionTier(folder: string): 0 | 1 | 2 | 3 {
  if (folder === 'root') return 0;
  return Math.min(folder.split('/').length, 3) as 1 | 2 | 3;
}
```

### Migration

No env var fallback — clean rename, one-time migration.

1. Rename DB: `UPDATE registered_groups SET folder = 'root' WHERE folder = 'main'`
2. Rename filesystem: `mv groups/main groups/root`
3. Update routing rules referencing `main`
4. Add migration skill step for agent-side references

~24 references to `isRoot()` in production code. Key files:
config.ts, container-runner.ts, index.ts, ipc.ts,
action-registry.ts, actions/\*.ts, task-scheduler.ts.

## What each tier can and cannot do

### Root (tier 0)

Can: see all messages everywhere, run any IPC action on any
group, create children of any world, modify own CLAUDE.md and
skills, read gateway source (ro), schedule tasks on any group,
delegate to any group, set routing rules for any group.

Cannot: create new worlds (CLI only), write gateway source
directly (staging area only, see specs/v2m1/agent-code-modification.md).

Write level: unrestricted. All mounts rw except /workspace/self/ (ro).

### World (tier 1)

Can: see messages routed to own world and all descendants,
run IPC actions scoped to own world, create children within
own world, set routing rules for own children, send messages
to any JID in own world, modify own CLAUDE.md/skills/memory,
schedule tasks within own world.

Cannot: see other worlds, see root's data, see gateway source,
create new worlds, affect groups outside own world.

Write level: unrestricted (within own group mount). No
/workspace/self/ mount at all.

### Agent (tier 2)

Can: see messages routed to own JIDs only, send messages and
files to own JID, delegate to own children, schedule tasks
for own group, escalate to parent, write working files/memory/
notes to own workdir.

Cannot: modify own CLAUDE.md or skills, see parent or sibling
messages, create groups, set routing rules, see gateway source,
see share/ (ro only), see sessions.

Write level: workdir. Setup files (CLAUDE.md, skills, SOUL.md)
mounted ro. Workdir (everything else in group/) mounted rw.
.claude/ (memory) mounted rw.

### Worker (tier 3)

Can: see messages routed to own JIDs only, send messages to
own JID, escalate to parent.

Cannot: write anything (all mounts ro), send files, schedule
tasks, delegate, create groups, set routing rules.

Write level: readonly. Everything mounted ro. IPC still works
(writes to /workspace/ipc/ are allowed but limited to request
files only).

## Group directory layout

Everything lives inside the group dir, mounted as
`/workspace/group/`. Media also gets a convenience mount
at `/workspace/media/` (same data, second path).

```
groups/<folder>/
  ├── CLAUDE.md        setup (ro for tier 2, ro for tier 3)
  ├── SOUL.md          setup (ro for tier 2, ro for tier 3)
  ├── skills/          setup (ro for tier 2, ro for tier 3)
  ├── diary/           workdir — agent daily notes (rw for tier 2)
  ├── facts/           workdir — knowledge files (rw for tier 2)
  ├── media/           workdir — enriched attachments (rw for tier 2)
  ├── logs/            workdir — conversation logs (rw for tier 2)
  └── (anything else)  workdir (rw for tier 2)
```

**share/** lives at `groups/<world>/share/`, mounted as
`/workspace/share/`. Cross-group knowledge sharing within
a world. rw for root+world, ro for agent+worker.

## Workdir boundary enforcement

The "workdir=rw, setup=ro" split for tier 2 agents needs
enforcement at the docker mount level:

```
# Group dir — rw (base mount)
-v groups/atlas/support:/workspace/group:rw

# Setup file overrides — ro (more specific, takes precedence)
-v groups/atlas/support/CLAUDE.md:/workspace/group/CLAUDE.md:ro
-v groups/atlas/support/skills:/workspace/group/skills:ro
-v groups/atlas/support/SOUL.md:/workspace/group/SOUL.md:ro
```

Docker mount precedence: more specific mounts override less
specific ones. The ro overrides on setup files are enforced by
the runtime, not bypassable by the agent.

Tier 3 workers: single ro mount on the whole group dir.
No overrides needed — everything is readonly.

## Related specs

- specs/v2m1/escalation.md — upward delegation protocol
- specs/v2m1/prototypes.md — per-JID group spawning
- specs/v2m1/agent-code-modification.md — root staging area
