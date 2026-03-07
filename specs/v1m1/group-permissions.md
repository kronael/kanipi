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

## Design: Hierarchy-Implied Permissions

Instead of explicit roles, derive permissions from position in
the group hierarchy. The folder path IS the permission model.

### Permission tiers

```
root group     (folder: "main")          → admin
  child group  (folder: "main/research") → worker
    leaf group (folder: "main/research/web") → restricted
```

| Tier                  | Depth      | Can write own files | Can write CLAUDE.md | IPC actions       | Delegate    |
| --------------------- | ---------- | ------------------- | ------------------- | ----------------- | ----------- |
| root (depth 0)        | `main`     | yes                 | yes                 | all               | to children |
| worker (depth 1)      | `main/X`   | yes                 | yes                 | own group         | to children |
| restricted (depth 2+) | `main/X/Y` | group folder only   | no                  | send_message only | no          |

### How restricted mode works

Depth >= 2 groups get:

- `/workspace/group/` mounted read-only (or specific subdirs rw)
- CLAUDE.md baked in at spawn, not writable
- Skills directory read-only (seeded once)
- Only `send_message` and `reset_session` IPC actions
- Cannot delegate further

This means: the atlas support frontend would be `main/support`
(worker) or `main/support/public` (restricted). The researcher
backend would be `main/research` (worker, can write facts/).

### Overrides via container_config

For cases where hierarchy doesn't fit, container_config on the
registered_groups row can override:

```json
{
  "permissions": {
    "writeGroupFolder": true,
    "writeClaude": false,
    "actions": ["send_message", "delegate_group"],
    "mountMode": "ro"
  }
}
```

Overrides can only restrict (not escalate). A depth-2 group
cannot grant itself root actions via config.

## Implementation

### 1. Auth middleware in action registry

Currently: `ctx.isRoot` check per action handler.

New: `isAuthorized(ctx, action)` checks tier + overrides.

```typescript
function permissionTier(folder: string): 'root' | 'worker' | 'restricted' {
  const depth = folder.split('/').length - 1;
  if (depth === 0) return 'root';
  if (depth === 1) return 'worker';
  return 'restricted';
}
```

### 2. Container mount enforcement

In container-runner.ts buildVolumeMounts, check tier:

- restricted: mount group folder ro, skip .claude/CLAUDE.md write
- worker: current behavior (rw group folder)
- root: current behavior (rw + sessions access)

### 3. CLI actions via IPC

Expose CLI operations as IPC actions so root/worker agents can
manage groups programmatically:

| CLI command | IPC action       | Min tier |
| ----------- | ---------------- | -------- |
| group list  | list_groups      | worker   |
| group add   | register_group   | root     |
| group rm    | unregister_group | root     |
| mount list  | list_mounts      | root     |
| mount add   | add_mount        | root     |
| user list   | list_users       | root     |

These already exist partially (register_group action). The gap
is: group list and mount operations aren't IPC actions yet.

### 4. Protect system files from agent modification

For restricted tier:

- CLAUDE.md: copy (not symlink) at spawn, don't persist changes
- Skills: mount read-only
- MEMORY.md: allow read, block write (or allow — it's agent memory)

For worker tier:

- CLAUDE.md: writable (agent self-extension is a feature)
- Skills: writable
- But: migration files read-only (agent shouldn't modify upgrade path)

### 5. Agent self-modification (code access)

Root group currently sees /workspace/self/ (ro). For an agent to
modify its own code:

Option A: mount gateway src as rw for root, agent runs build
Option B: agent writes to a staging area, gateway picks up on restart
Option C: agent uses IPC action to request code change (gateway validates)

Option B is safest — agent proposes, gateway applies.

### 6. Version control for agent-modified files

When agents modify CLAUDE.md, skills, or facts:

- Group folder is already gitignored (agent state, not source)
- Skills are seeded from container/ (source of truth in git)
- Agent modifications are instance-specific, not version-controlled

For version control of agent changes:

- Agent diary already tracks what changed
- Could add git init in group folder (agent manages own repo)
- Or: gateway snapshots group folder on session end

## Open Questions

1. **Is hierarchy-implied enough?** The depth-based tier is simple
   but may be too rigid. What if a depth-1 group needs to be
   restricted? Override config handles this, but adds complexity.

2. **MEMORY.md for restricted agents** — should restricted agents
   be able to write their own memory? It's useful for learning
   but also a vector for persisting prompt injection.

3. **Delegation direction** — currently only parent→child. Should
   restricted agents be able to delegate UP (ask parent for help)?
   The atlas frontend/backend split needs this.

4. **Action granularity** — is per-action sufficient or do we need
   per-resource? E.g., "can send_message but only to this JID" vs
   "can send_message to any JID in my world."

5. **Hot reload** — should permission changes require restart or
   take effect immediately? Current registered_groups changes
   require restart.

6. **Audit** — should permission-denied events be logged specially?
   Currently they throw and log as errors.

7. **Agent code modification** — is option B (staging area) the
   right approach? What's the review/approval flow?

8. **Mount inheritance** — should child groups inherit parent's
   extra mounts? Currently each group configures independently.
