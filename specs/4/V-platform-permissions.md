---
status: spec
---

# Action Grants

Token-based permission system for IPC actions. Every container
session receives a grant rule list derived from routing + tier.
Gateway validates at dispatch time. Delegation narrows scope —
agents cannot self-escalate. Denied actions are hidden from the
manifest; param constraints are surfaced per-action.

## Problem

Any group with a platform JID routed to it can call any action.
No mechanism to restrict a child group to read-only, or to grant
a delegated agent only specific actions.

## Rule format

Function-call syntax with glob matching:

```
[!]action_glob([param=glob, ...])
```

Examples:

```
twitter_*()                   allow all twitter actions
!twitter_post()               deny twitter post
send_message(jid=telegram:*)  allow send_message, only telegram JIDs
email_send(to=*@company.com)  allow email send, only to company
*()                           allow everything (root default)
```

- `!` prefix = deny
- `*` glob in action name and param values
- Last match wins
- No match = deny (fail-closed)
- Params are optional — omitted means no constraint

## Grant rules storage

A `grants` table in the gateway DB for overrides only:

```sql
CREATE TABLE grants (
  folder TEXT NOT NULL,
  rules  TEXT NOT NULL,   -- JSON: ["twitter_*()","!twitter_post()"]
  PRIMARY KEY (folder)
);
```

## Token lifecycle

```
container spawns
  → gateway derives default rules from routing table + tier
    → gateway reads grant overrides from DB (if any)
      → rules injected into start.json
        → rules resolve into action manifest (with constraints)
          → agent calls IPC action
            → gateway validates against rules
              → dispatch or deny
```

On delegation:

```
parent calls delegate_group with extra rules
  → child rules = parent rules + child's narrowing rules appended
    → last-match-wins: appended denies override parent allows
      → can only narrow, never widen
```

## Token format

Injected into `start.json` alongside existing fields:

```json
{
  "grants": [
    "twitter_*()",
    "!twitter_post()",
    "send_message(jid=telegram:*)",
    "email_send()"
  ]
}
```

## Agent visibility

The agent never parses grant rules. The action manifest reflects
the resolved permissions:

- **Denied actions** → removed from manifest entirely
- **Allowed, no constraints** → normal manifest entry
- **Allowed with constraints** → `constraints` field added

```json
[
  {
    "name": "twitter_reply",
    "description": "Reply to a tweet",
    "input": { ... }
  },
  {
    "name": "send_message",
    "description": "Send a message to a chat",
    "input": { ... },
    "constraints": ["jid=telegram:*"]
  }
]
```

The agent reads constraints to know its limits. The gateway
enforces them — if the agent violates a constraint, the request
is denied.

## Defaults

Default rules are derived from the routing table + tier:

- **Tier 0 (root)** — `["*()"]`. All actions, no constraints.
- **Tier 1 (world root, e.g. `atlas`)** — allow rules for every
  action whose platform has a route to the world root OR any
  subgroup in that world. If `twitter:*` routes to
  `atlas/social`, then `atlas` gets `twitter_*()` by default.
- **Tier 2 (e.g. `atlas/social`)** — allow rules for actions
  on platforms that route to this folder or any of its children.
- **Tier 3+ (leaf)** — allow rules for actions on platforms
  that route directly to this folder only.

No grants table row needed for the common case.

The `grants` table is only for overrides:

- **Restrict** — deny a group access to an action it would
  normally have via routing (e.g. `!twitter_post()` on `atlas`
  even though `twitter:*` routes through its world)
- **Delegate** — give a child group explicit access to actions
  on a JID that routes to the parent

If no grants row exists for a folder, the routing-derived
default applies. If a grants row exists, its rules are appended
after the defaults (last-match-wins).

## Authority

Same rules as routing:

- Tier 0 (root) — can create/delete any grant
- Tier 1 (world root) — can grant to descendants in own world
- Tier 2+ — cannot modify grants

## IPC actions

- `set_grants` — set grant rules for a folder (replaces all)
- `get_grants` — list grant rules for a folder
- `delegate_group` — existing action, add optional `grants` param

## Module: `src/grants.ts`

Self-contained module. No dependency on IPC, action-registry, or
container-runner. Callers import what they need.

```typescript
type Rule = string;  // "twitter_*()", "!send_message(jid=tg:*)"

// Parse
parseRule(rule: string): { deny: boolean; action: string; params: Map<string, string> }

// Build default rules at container spawn
deriveRules(folder: string, tier: number): Rule[]

// Check at dispatch time
checkAction(rules: Rule[], action: string, params: Record<string, string>): boolean
  // walk rules, last match wins, no match = deny

// Resolve constraints for manifest
resolveConstraints(rules: Rule[], action: string): string[] | null
  // null = denied (omit from manifest), [] = allowed no constraints,
  // ["jid=telegram:*"] = allowed with constraints

// Narrow on delegation
narrowRules(parent: Rule[], child: Rule[]): Rule[]
  // parent + child appended (child can only add denies or narrow)

// DB operations
getGrantOverrides(folder: string): Rule[] | null
setGrantOverrides(folder: string, rules: Rule[]): void
deleteGrantOverrides(folder: string): void
```

### Integration points

IPC dispatch (`ipc.ts:drainRequests`) calls `checkAction` before
`action.handler`. The rules live on the IPC context, set once
when the container starts.

Container spawn (`container-runner.ts`) calls `deriveRules` and
writes the result into `start.json`.

Manifest generation (`action-registry.ts:getManifest`) calls
`resolveConstraints` per action to filter denied actions and
annotate constraints.

Delegation (`actions/groups.ts:delegateGroup`) calls
`narrowRules` when a parent passes grants to a child.

The module reads routes from DB (same as routing) but owns its
own `grants` table. No coupling to action-registry internals.

## Enforcement

At dispatch time (`ipc.ts`), before calling `action.handler`:

1. Build params map from action input (e.g. `{ jid: "telegram:-123" }`)
2. `checkAction(rules, actionName, params)` → allow or deny
3. If denied → reply with error, skip handler

## Security

- Agent cannot edit grants DB (not mounted in container)
- Rules are ephemeral (per-session, in start.json)
- Delegation can only narrow, never widen (`narrowRules`)
- Missing grants table row → routing-derived defaults apply
- Missing grants in start.json → default `["*()"]` for
  backward compat during rollout
- `grants.ts` has no side effects — pure functions + DB reads

## Migration

1. Gateway DB migration: add `grants` table
2. Add `src/grants.ts` module
3. Add `constraints` field to manifest output
4. Add `grants` (rules) to `start.json` via `deriveRules`
5. Add `checkAction` guard in `ipc.ts:drainRequests`
6. Add `grants` param to `delegate_group` IPC
7. Agent-side: read constraints from manifest

## Not in scope

- Grant expiry / TTL
- Per-action override in group config (future)
- Rule inheritance across worlds (each world independent)
