# Group Permissions

**Status**: not started

## Problem

Binary root/non-root is insufficient. Need:

- Public agents that can't modify their own setup
- Subgroups with specific capabilities
- CLI ops available to agents with proper access control
- DB never directly accessible by agents (already true)

## Hierarchy

Three differentiated tiers. Max 3 levels of nesting.

```
root                     tier 0 — god mode
├── atlas/               tier 1 — world (isolated)
│   ├── atlas/support    tier 2 — agent
│   └── atlas/research   tier 2 — agent
├── yonder/              tier 1 — world (isolated)
│   └── yonder/web       tier 2 — agent
└── (no world needed)    tier 0 alone works for simple setups
```

### Tier 0: root

The admin agent. Folder name: `root` (rename from current
`main` — see codebase changes below). One per instance.

- Sees all worlds, all groups, all messages
- Can modify gateway code (staging area, not direct)
- All IPC actions, no world boundary
- rw everything
- If you don't need structure, root alone is sufficient

### Tier 1: world

Top-level group. Isolated namespace. Sees only what's below.

- All IPC actions scoped to own world
- Can create children (register_group within own world)
- Can set routing_rules for own children
- send_message to any JID registered in own world
- rw own group folder, CLAUDE.md, skills
- Cannot see other worlds
- Cannot see root's data

### Tier 2: agent

Default: worker. Can be restricted via container_config.

Worker (default):

- rw own group workdir, ro CLAUDE.md/skills (see write levels below)
- send_message/send_file to own JID
- delegate to own children
- schedule tasks for own group
- escalate to parent (upward delegation)

Restricted (via container_config override):

- ro everything
- send_message only
- escalate to parent only
- no delegation, no scheduling

```typescript
function permissionTier(folder: string): 0 | 1 | 2 {
  if (folder === 'root') return 0;
  const depth = folder.split('/').length;
  return Math.min(depth, 2) as 1 | 2;
}
```

## World creation

- **CLI only** — agents cannot create new worlds
- Root agent can create children of existing worlds
- World agents can create children within own world
- Tier 2 agents cannot create groups

```
register_group authorization:
  tier 0: can create anything except new worlds (CLI only)
  tier 1: can create children in own world
  tier 2: cannot create groups
  CLI:    unrestricted
```

Wait — should root be able to create worlds? Or CLI only?
Decision: **worlds are CLI only**. Root can create children
of worlds but not new worlds. Worlds are infrastructure.

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
skills, memory, workdir). Used by root and world agents.

**workdir** — rw group workdir only, ro CLAUDE.md/skills/setup.
Agent can write notes, memory, working files. Cannot modify
its own instructions or skills. Default for tier 2 workers.

Restricted tier 2 agents get ro on everything (no writes at all).

This is sufficient because:

- Setup is concentrated in CLAUDE.md (global + group level)
- Agent can't rewrite its own instructions
- Prompt injection blast radius is limited to workdir
- Prototype pattern (below) isolates per-JID state further

## Prototypes

A group can be a **prototype** — a template that is never
routed to directly. When a new JID needs routing, the gateway
spawns a new group as a copy of the prototype.

```
atlas/support/web         prototype (template, no routing)
atlas/support/web:user123 spawned instance (copy of prototype)
atlas/support/web:user456 spawned instance (copy of prototype)
```

Use cases:

- Support tickets: each ticket gets its own agent instance
- Public forum: each user conversation is isolated
- Any scenario where per-JID state isolation matters

The prototype's CLAUDE.md, skills, and setup are copied to
each spawn. Spawned instances get workdir-level writes —
they can write memory/notes but can't modify the template.
The prototype itself stays clean.

Spawn lifecycle: created on first message, destroyed on idle
timeout or explicit cleanup. Prototype updates don't propagate
to existing spawns (they get the template at creation time).

## Escalation (upward delegation)

Tier 2 agents can ask their parent for help. Inverse of
`delegate_group`.

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

| Action              | Tier 0 | Tier 1       | Tier 2 (worker) | Tier 2 (restricted) |
| ------------------- | ------ | ------------ | --------------- | ------------------- |
| send_message        | any    | own world    | own JID         | own JID             |
| send_file           | any    | own world    | own JID         | no                  |
| schedule_task       | any    | own world    | own group       | no                  |
| pause/resume/cancel | any    | own world    | own group       | no                  |
| register_group      | yes\*  | own children | no              | no                  |
| set_routing_rules   | yes    | own children | no              | no                  |
| delegate_group      | yes    | own children | own children    | no                  |
| escalate            | n/a    | n/a          | to parent       | to parent           |
| refresh_groups      | yes    | no           | no              | no                  |
| reset_session       | yes    | yes          | yes             | yes                 |
| list_actions        | yes    | yes          | yes             | yes                 |

\*root cannot create worlds (CLI only), but can create world children

## Container mount enforcement

Write level determines mount mode. "workdir" means the group's
working directory is rw but setup files (CLAUDE.md, skills) are ro.

| Mount                     | Tier 0 | Tier 1 | Tier 2 (worker)      | Tier 2 (restricted) |
| ------------------------- | ------ | ------ | -------------------- | ------------------- |
| /workspace/group/         | rw     | rw     | workdir=rw, setup=ro | ro                  |
| /home/node/.claude/       | rw     | rw     | rw                   | ro                  |
| /workspace/self/          | ro     | ro     | no                   | no                  |
| /workspace/data/sessions/ | rw     | no     | no                   | no                  |
| /workspace/share/         | rw     | rw     | ro                   | ro                  |
| /workspace/ipc/           | rw     | rw     | rw                   | rw (limited)        |

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

// Tier from folder
function permissionTier(folder: string): 0 | 1 | 2 {
  if (folder === 'root') return 0;
  return Math.min(folder.split('/').length, 2) as 1 | 2;
}
```

### Migration

No env var fallback — clean rename, one-time migration.

1. Rename DB: `UPDATE groups SET folder = 'root' WHERE folder = 'main'`
2. Rename filesystem: `mv groups/main groups/root`
3. Update routing rules referencing `main`
4. Add migration skill step for agent-side references

~30 references to `isRoot()` across src/. Key files:
config.ts, container-runner.ts, index.ts, ipc.ts,
action-registry.ts, actions/\*.ts, task-scheduler.ts.

## Open Questions

1. **Agent code modification** — root sees /workspace/self/ (ro).
   Staging area for code changes. Separate spec:
   specs/v2m1/agent-code-modification.md

2. **Prototype spawn naming** — `group:jid` convention? Or
   subdirectory? How to avoid filesystem name collisions?

3. **Prototype spawn limits** — max concurrent spawns per
   prototype? Cleanup policy for idle spawns?

4. **Prototype update propagation** — when prototype changes,
   do existing spawns get updated? Or only new spawns?

5. **Workdir boundary** — how to enforce setup=ro within a
   single mount? Separate mounts for setup vs workdir?
   Or trust CLAUDE.md instructions + file permissions?
