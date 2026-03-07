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

Worker or restricted, depending on config. Default: worker.

Worker (default):

- rw own group folder, CLAUDE.md, skills
- send_message/send_file to own JID
- delegate to own children
- schedule tasks for own group
- escalate to parent (upward delegation)

Restricted (via container_config override):

- ro group folder, ro CLAUDE.md, ro skills
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

| Mount                     | Tier 0 | Tier 1 | Tier 2 (worker) | Tier 2 (restricted) |
| ------------------------- | ------ | ------ | --------------- | ------------------- |
| /workspace/group/         | rw     | rw     | rw              | ro                  |
| /home/node/.claude/       | rw     | rw     | rw              | ro                  |
| /workspace/self/          | ro     | ro     | no              | no                  |
| /workspace/data/sessions/ | rw     | no     | no              | no                  |
| /workspace/share/         | rw     | rw     | ro              | ro                  |
| /workspace/ipc/           | rw     | rw     | rw              | rw (limited)        |

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

Existing instances: migration renames `main` → `root` in DB
and filesystem. Or: make "root" configurable via env
(`ROOT_FOLDER=main`), default `root` for new instances.

### Files to change

~30 references to `isRoot()` across src/. The function
signature stays the same but the logic changes. Key files:
config.ts, container-runner.ts, index.ts, ipc.ts,
action-registry.ts, actions/\*.ts, task-scheduler.ts.

## Open Questions

1. **Root folder name** — rename existing `main` folders to
   `root`? Or keep `main` and add `ROOT_FOLDER` env var?

2. **World message visibility** — world agents see all messages
   in their world. Should tier 2 agents see only their own JID's
   messages, or all messages in their world? Currently: own only.

3. **Restricted MEMORY.md** — block writes? Agent memory is
   useful but also a prompt injection persistence vector.

4. **Escalation protocol** — structured JSON? Free text?
   XML like system messages? Needs own spec.

5. **Mount inheritance** — should tier 2 inherit parent world's
   extra mounts? Or configure per-group?

6. **Agent code modification** — root sees /workspace/self/ (ro).
   Staging area approach: agent writes to staging dir, gateway
   applies on restart. Needs own spec.

7. **Existing instances** — migration path for kanipi_marinade
   et al. that use folder=main as root.
