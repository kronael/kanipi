# Group Permissions

**Status**: not started

## Problem

Current model is binary: root or non-root. Root can do everything,
non-root is scoped to own group. This is insufficient for:

1. Public-facing agents (atlas support) that should not modify
   their own CLAUDE.md, skills, or system files
2. Subgroups that need specific capabilities (research agent
   needs write access to facts/, frontend agent doesn't)
3. Making CLI management available to agents without giving
   full root access
4. Controlling which agents can see/modify what data

## Current State

### What root can do (non-root cannot)

- register_group, set_routing_rules, refresh_groups
- send_message/send_file to ANY JID
- schedule tasks for ANY group
- access /workspace/data/sessions/ (rw)
- see all groups in available_groups.json

### What ANY agent can do (no permission check)

- Read/write own group folder (/workspace/group/)
- Modify own CLAUDE.md, skills, MEMORY.md
- Read gateway source (/workspace/self/, ro)
- Create diary entries
- Reset own session

### What no agent can do

- Access SQLite DB directly (all through IPC)
- Modify mount-allowlist.json (stored outside project)
- See other groups' folders (not mounted)

## Worlds and Groups

A **world** is an independent root group. An instance can host
multiple worlds. Each world has its own hierarchy.

```
instance: kanipi_marinade
  ├── main/              → world "main" (root)
  │   ├── main/support   → child (worker)
  │   └── main/research  → child (worker)
  ├── atlas/             → world "atlas" (root)
  │   └── atlas/web      → child (worker)
  └── yonder/            → world "yonder" (root)
```

**World isolation**: agents cannot delegate across worlds.
`main/*` cannot reach `atlas/*`. This is enforced by
`isAuthorizedRoutingTarget` (must share root segment).

**World creation is CLI-only**. Agents can create child groups
within their own world via `register_group`, but cannot create
new root groups. A root agent in `main` can create `main/foo`
but not `atlas/`. New worlds are an admin decision.

```
register_group authorization:
  - root agent: can create children in own world only
  - worker agent: cannot create groups
  - restricted agent: cannot create groups
  - CLI: can create anything (no restrictions)
```

## Design: Hierarchy-Implied Permissions

Instead of explicit roles, derive permissions from position in
the group hierarchy. The folder path IS the permission model.

### Permission tiers

| Tier                  | Depth      | Can write own files | Can write CLAUDE.md | IPC actions             | Delegate     |
| --------------------- | ---------- | ------------------- | ------------------- | ----------------------- | ------------ |
| root (depth 0)        | `main`     | yes                 | yes                 | all (own world)         | to children  |
| worker (depth 1)      | `main/X`   | yes                 | yes                 | own group + delegate    | to children  |
| restricted (depth 2+) | `main/X/Y` | group folder only   | no                  | send_message + escalate | up to parent |

```typescript
function permissionTier(folder: string): 'root' | 'worker' | 'restricted' {
  const depth = folder.split('/').length - 1;
  if (depth === 0) return 'root';
  if (depth === 1) return 'worker';
  return 'restricted';
}
```

### Root tier (depth 0)

Full admin within its world. Cannot affect other worlds.

- All IPC actions, scoped to own world
- register_group: children in own world only
- set_routing_rules: own world groups only
- send_message: to any JID registered in own world
- rw group folder, CLAUDE.md, skills
- access /workspace/data/sessions/ (for migrations)

### Worker tier (depth 1)

Standard agent. Can modify itself, delegate down.

- send_message, send_file: own group's JID only
- schedule_task: own group only
- delegate_group: to own children
- rw group folder, CLAUDE.md, skills
- no register_group, no set_routing_rules

### Restricted tier (depth 2+)

Sandboxed agent. Read-only, minimal actions, can ask
parent for help.

- /workspace/group/ mounted read-only
- CLAUDE.md baked in at spawn, not writable
- Skills directory read-only
- send_message and reset_session only
- **escalate**: new action, sends request to parent group
  (inverse of delegate — child asks parent for help)
- Cannot delegate further down

### Escalation (upward delegation)

Restricted agents need a way to ask their parent for help.
This is the atlas frontend→backend pattern.

```
user → atlas/support/public (restricted, answers from facts)
         → escalate to atlas/support (worker, runs research)
              → returns findings
         → presents answer to user
```

`escalate` is like `delegate_group` but upward:

- Only to direct parent (one level up)
- Parent receives structured request, not raw user message
- Parent returns findings via IPC reply
- Restricted agent formats and presents to user

### Overrides via container_config

For cases where hierarchy doesn't fit, container_config on the
registered_groups row can restrict (never escalate):

```json
{
  "permissions": {
    "writeClaude": false,
    "actions": ["send_message", "escalate"],
    "mountMode": "ro"
  }
}
```

A root group could restrict itself to worker-level. A worker
could restrict itself to restricted-level. But a restricted
group cannot grant itself worker actions.

## Implementation

### 1. World-scoped authorization

Change `register_group` to enforce world boundaries:

```typescript
// Root can only create children in own world
if (tier === 'root') {
  const myWorld = ctx.sourceGroup.split('/')[0];
  if (!newFolder.startsWith(myWorld + '/')) {
    throw new Error('cannot create groups outside own world');
  }
}
```

Same pattern for set_routing_rules, send_message (check target
JID's group is in same world).

### 2. Container mount enforcement

In container-runner.ts buildVolumeMounts, check tier:

- restricted: mount group folder ro, .claude/ ro
- worker: current behavior (rw group folder)
- root: current behavior (rw + sessions access)

### 3. CLI actions via IPC

Expose CLI operations as IPC actions:

| CLI command | IPC action       | Min tier |
| ----------- | ---------------- | -------- |
| group list  | list_groups      | worker   |
| group add   | register_group   | root     |
| group rm    | unregister_group | root     |
| mount list  | list_mounts      | root     |
| mount add   | add_mount        | root     |
| user list   | list_users       | root     |

All scoped to own world (root sees own world's groups, not all).

### 4. Protect system files

For restricted tier:

- CLAUDE.md: copy (not symlink) at spawn, don't persist changes
- Skills: mount read-only
- MEMORY.md: read-only (prompt injection persistence vector)

For worker tier:

- CLAUDE.md: writable (agent self-extension is a feature)
- Skills: writable
- Migration files: read-only

### 5. Agent self-modification (code access)

Root group sees /workspace/self/ (ro). For modifying gateway code:

- Agent writes proposed changes to a staging directory
- Gateway picks up on restart or via IPC action
- No direct rw access to gateway source

### 6. Version control for agent-modified files

- Group folder is gitignored (instance state, not source)
- Skills seeded from container/ (git is source of truth)
- Agent modifications are instance-specific
- Agent diary tracks what changed
- Could: git init in group folder, agent manages own repo
- Could: gateway snapshots group folder on session end

## Open Questions

1. **Worker CLAUDE.md write** — should workers be able to
   modify their own CLAUDE.md? It's the self-extension feature
   but also a risk if the worker is user-facing.

2. **MEMORY.md for restricted** — completely block, or allow
   read-only? Useful for agent context but injection risk.

3. **Escalation protocol** — what's the request/response format
   between restricted child and worker parent? Structured JSON?
   Free-text prompt? XML like system messages?

4. **Cross-world visibility** — should root agents see other
   worlds exist (names only, no access)? Useful for admin
   dashboards. Currently available_groups shows everything.

5. **Hot reload** — permission changes via container_config
   take effect on next container spawn (not mid-session).
   Is this sufficient?

6. **Audit trail** — log permission-denied events to a
   dedicated table? Or just journalctl?

7. **Mount inheritance** — should children inherit parent's
   extra mounts? Or configure independently per group?

8. **World admin transfer** — can CLI transfer root of a world
   to a different group? (e.g., rename main → legacy, make
   main/v2 the new root). Probably not needed.
