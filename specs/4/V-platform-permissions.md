---
status: spec
---

# Action Grants

Token-based permission system for IPC actions. Every container
session receives an action token derived from the group's grants.
Gateway validates the token at dispatch time. Delegation narrows
the token scope — agents cannot self-escalate.

## Problem

Any group with a platform JID routed to it can call any action.
No mechanism to restrict a child group to read-only, or to grant
a delegated agent only specific actions.

## Model

A `grants` table in the gateway DB:

```sql
CREATE TABLE grants (
  folder  TEXT NOT NULL,
  scope   TEXT NOT NULL,   -- "twitter", "email", "*"
  actions TEXT NOT NULL,   -- JSON: ["*"] or ["post","reply"]
  PRIMARY KEY (folder, scope)
);
```

## Token lifecycle

```
group created (CLI / auto-thread / clone)
  → default grants seeded in DB: (folder, "*", '["*"]')
    → container spawns
      → gateway reads grants from DB
        → token injected into start.json
          → agent calls IPC action + token
            → gateway validates token
              → dispatch or deny
```

On delegation:

```
parent calls delegate_group with grants subset
  → gateway intersects parent token with requested grants
    → child token = intersection (can only narrow, never widen)
      → child container gets scoped token
```

## Token format

Injected into `start.json` alongside existing fields:

```json
{
  "grants": {
    "twitter": ["post", "reply", "like"],
    "email": ["send"],
    "*": ["*"]
  }
}
```

Agent passes `grants` back with each IPC action call. Gateway
validates: does `grants[scope]` include the requested action?

## Defaults

On group creation, seed `(folder, "*", '["*"]')` — full access,
same as today. Restriction is opt-in. Specific defaults per
platform TBD — will iterate based on real usage patterns.

## Authority

Same rules as routing:

- Tier 0 (root) — can create/delete any grant
- Tier 1 (world root) — can grant to descendants in own world
- Tier 2+ — cannot modify grants

## IPC actions

- `set_grants` — set grants for a folder (replaces all)
- `get_grants` — list grants for a folder
- `delegate_group` — existing action, add optional `grants` param

## Enforcement

In `action-registry.ts` at dispatch time:

1. Extract scope from action (e.g. `post_tweet` → `twitter`)
2. Check token: `grants["twitter"]` includes `"post"` or `"*"`?
3. Check token: `grants["*"]` includes `"*"`?
4. If no match → deny with error message

## Security

- Agent cannot edit grants DB (not mounted in container)
- Token is ephemeral (per-session, in start.json)
- Delegation can only narrow, never widen (gateway intersects)
- Missing grants table row → no access (fail-closed)
- Missing grants in start.json → default `{"*": ["*"]}` for
  backward compat during rollout

## Migration

1. Gateway DB migration: add `grants` table
2. Seed existing groups with `("*", '["*"]')`
3. Add `grants` field to `start.json` and container input
4. Enforce in action-registry (check token)
5. Add `grants` param to `delegate_group` IPC
6. Agent-side migration: document grants in action manifest

## Not in scope

- Per-action override in group config (future)
- Read/write distinction (future — just action names for now)
- Grant expiry / TTL
