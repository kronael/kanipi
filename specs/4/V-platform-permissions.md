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
twitter_*                       allow all twitter actions, any params
twitter_*()                     same as above (parens optional)
!twitter_post                   deny twitter post
send_message(jid=telegram:*)    jid constrained, other params allowed
twitter_post(!media)             media param must not be present
*                               allow everything (root default)
```

- `!` prefix = deny
- Parsed as: `[!] name [( params )]` — name and params are separate
- `*` in name matches `[a-zA-Z0-9_]` only (identifier chars)
- `*` in param values matches any char except `,` and `)`
- Specifying a param constrains only that param — unmentioned
  params are allowed
- `!param` inside parens = param must NOT be present
- No parens or `()` = any params (equivalent)
- Last match wins; no match = deny

## Defaults (from routing table)

- **Tier 0 (root)** — `["*"]`. All actions, all grants.
- **Tier 1 (world root)** — all actions on every platform with
  at least one route in the world. Single-account model: if a
  platform connects to the world, the world root gets full
  access (post, reply, react, follow, ban, set_profile, etc.).
  `["post", "reply", "react", "set_profile", ...]` per platform.
- **Tier 2** — `send_message` + `send_reply` + social actions
  on routed platforms. Can do cross-user messaging (send to
  different chats than the receipt).
- **Tier 3+ (leaf)** — `send_reply` only. Same chat/thread,
  gateway-handled threading. No cross-chat, no post, no react.
  Everything else needs explicit grant override.

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
