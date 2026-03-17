---
status: spec
---

# Action Grants

Grant rules control which IPC actions a container can call.
Rules are derived from routing + tier at spawn, injected into
`start.json`, validated at dispatch. Agents see allowed actions
with their matching rules in the manifest.

## Rule syntax

```
[!]action_glob[(param=glob, ...)]
```

```
twitter_*                     allow all twitter actions, any params
twitter_*()                   allow all twitter actions, no params
!twitter_post                 deny twitter post
send_message(jid=telegram:*)  only telegram JIDs
*                             allow everything (root default)
```

- `!` prefix = deny
- Parsed as: `[!] name [( params )]` — name and params are separate
- `*` in name matches `[a-zA-Z0-9_]` only (identifier chars)
- `*` in param values matches any char except `,` and `)`
- No parens = any params allowed
- Empty parens `()` = no params allowed
- `(k=v, k2=v2)` = only these params, glob-matched
- Last match wins; no match = deny

## Defaults (from routing table)

- **Tier 0 (root)** — `["*"]`
- **Tier 1 (world root)** — `platform_*` for every platform
  with a route anywhere in the world
- **Tier 2** — `platform_*` for routes to self + children
- **Tier 3+** — `platform_*` for routes to self only

## Overrides (DB)

```sql
CREATE TABLE grants (
  folder TEXT NOT NULL PRIMARY KEY,
  rules  TEXT NOT NULL  -- JSON string[]
);
```

Override rules are appended after defaults. Last-match-wins,
so appended `!deny` rules override default allows. No row =
defaults only.

## Token in start.json

```json
{ "grants": ["twitter_*", "!twitter_post", "send_message(jid=telegram:*)"] }
```

## Agent manifest

Denied actions omitted. Allowed actions include matching rules:

```json
{ "name": "twitter_reply", "grants": ["twitter_*"] }
{ "name": "send_message", "grants": ["send_message(jid=telegram:*)"] }
```

Same rule syntax everywhere — no translation.

## Delegation

Child rules = parent rules + narrowing rules appended.
Can only narrow, never widen.

## Module: `src/grants.ts`

Self-contained. No dependency on IPC or action-registry.

```typescript
type Rule = string;

parseRule(r: string): { deny: boolean; action: string; params: Map<string, string> }
deriveRules(folder: string, tier: number): Rule[]
checkAction(rules: Rule[], action: string, params: Record<string, string>): boolean
matchingRules(rules: Rule[], action: string): Rule[] | null
narrowRules(parent: Rule[], child: Rule[]): Rule[]
getGrantOverrides(folder: string): Rule[] | null
setGrantOverrides(folder: string, rules: Rule[]): void
```

## Integration

- `container-runner.ts`: `deriveRules` → write to `start.json`
- `ipc.ts`: `checkAction` before `action.handler`
- `action-registry.ts`: `matchingRules` in `getManifest`
- `actions/groups.ts`: `narrowRules` in `delegateGroup`

## Authority

- Tier 0 — any grant
- Tier 1 — descendants in own world
- Tier 2+ — cannot modify grants

## IPC actions

- `set_grants(folder, rules)` — replace rules
- `get_grants(folder)` — list rules
- `delegate_group` — add optional `grants` param

## Security

- Agent cannot edit grants DB (not in container)
- Rules ephemeral per-session
- Delegation can only narrow (`narrowRules`)
- No grants in start.json → `["*"]` (backward compat)

## Migration

1. DB: add `grants` table
2. Add `src/grants.ts`
3. `start.json`: add `grants` via `deriveRules`
4. `ipc.ts`: add `checkAction` guard
5. Manifest: add `grants` field via `matchingRules`
6. `delegate_group`: add `grants` param

## Not in scope

- Grant expiry / TTL
- Rule inheritance across worlds
