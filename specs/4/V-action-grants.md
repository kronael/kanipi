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
post                         allow post, any params
post(jid=twitter:*)          allow post, only to twitter
!post                        deny post
send_message(jid=telegram:*) allow send_message, only telegram
react(jid=reddit:*)          allow react, only on reddit
send_reply                   allow reply in same thread
*                            allow everything (root default)
```

- `!` prefix = deny
- Parsed as: `[!] name [( params )]` — name and params split first
- `*` in name matches `[a-zA-Z0-9_]` only (identifier chars)
- `*` in param values matches any char except `,` and `)`
- Specifying a param constrains only that param — unmentioned
  params are allowed
- `!param` inside parens = param must NOT be present
- No parens or `()` = any params (equivalent)
- Last match wins; no match = deny

Action names match actual IPC names: `post`, `reply`, `react`,
`send_message`, `send_reply`, `send_file`, `ban`, `delete`,
`set_profile`, `schedule_task`, `delegate_group`, etc.
Platform scoping is via the `jid` param (e.g. `jid=twitter:*`).

## Defaults (from routing table)

Derived from routing + tier. Platform access determined by which
JIDs have routes to the group (or its world/children per tier).

- **Tier 0 (root)** — `["*"]`. All actions, all params.
- **Tier 1 (world root)** — all actions on every platform with
  at least one route anywhere in the world. Single-account
  model: full social access (post, reply, react, follow, ban,
  set_profile, etc.) plus messaging. Derived as allow rules
  per routed platform: `post(jid=P:*)`, `reply(jid=P:*)`, etc.
- **Tier 2** — `send_message`, `send_reply`, plus social
  actions on platforms routed to self or children. Can do
  cross-user messaging (send to different chats).
- **Tier 3+ (leaf)** — `send_reply` only. Same chat/thread,
  gateway-handled threading. No cross-chat, no social actions.
  Everything else needs explicit grant override.

Replaces existing `assertAuthorized()` and `maxTier` checks —
grants become the single enforcement point.

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

Added alongside existing fields (sessionId, groupFolder,
chatJid, prompt, etc.):

```json
{ "grants": ["send_reply", "react(jid=twitter:*)", "!post"] }
```

## Agent manifest

Denied actions omitted. Allowed actions include matching rules:

```json
{ "name": "send_reply", "grants": ["send_reply"] }
{ "name": "react", "grants": ["react(jid=twitter:*)"] }
```

Same rule syntax everywhere. Agent reads its capabilities from
the manifest — same format as `start.json` grants.

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

`deriveRules` reads routes from DB to determine which platforms
are accessible per tier, then generates allow rules for each
action+platform combination.

## Integration

- `container-runner.ts` (startJson, ~line 669): call
  `deriveRules(folder, tier)`, add `grants` to start.json
- `ipc.ts` (drainRequests, ~line 186): call `checkAction`
  before `action.handler`, deny with error if check fails.
  Replaces existing `assertAuthorized()` and `maxTier` checks.
- `action-registry.ts` (getManifest, ~line 85): call
  `matchingRules` per action, omit denied, attach grants
- `actions/groups.ts` (delegateGroup, ~line 179): add optional
  `grants` param, call `narrowRules`

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
3. `container-runner.ts`: add `grants` to start.json
4. `ipc.ts`: add `checkAction` guard, remove `assertAuthorized`
5. `action-registry.ts`: add `grants` to manifest output
6. `actions/groups.ts`: add `grants` to `delegate_group`
7. Remove `maxTier` from actions (replaced by grants)

## Not in scope

- Grant expiry / TTL
- Rule inheritance across worlds
