---
status: spec
---

# Onboarding

Message from unrouted JID → notify root → approve → create
world → welcome message. Minimal: one hook point, one table,
two commands, one system message.

## Flow

```
message from unknown JID
  → no route match (index.ts:301)
  → if ONBOARDING_ENABLED:
    1. store in onboarding table (dedup by JID)
    2. notify() root: "New: alice via telegram:-12345"
    3. message dropped (not queued)
  → operator: /approve telegram:-12345
    4. create world folder
    5. add default route + predefined @ # routes
    6. enqueue welcome system message
    7. notify() root: "Approved: alice → alice/"
  → next message from JID processes normally
    8. agent sees welcome system message + user's message
    9. agent sends welcome, builds howto
```

## Config

```
ONBOARDING_ENABLED=0              # off by default
ONBOARDING_PROTOTYPE=             # optional: clone from prototype/
```

## Hook point

One change in `processGroupMessages` (index.ts:301):

```typescript
if (!group && onboardingEnabled) {
  enqueueOnboarding(chatJid, lastMessage);
  return true;
}
```

## Commands

Registered in `src/commands/` like `/status`:

### /approve <jid> [folder]

- Root-only (`permissionTier === 0`)
- Creates world: `groups/<folder>/` (folder derived from
  sender name or JID if not specified)
- Copies prototype if `ONBOARDING_PROTOTYPE` set
- Inserts group in DB (tier 1)
- Adds routes: default (seq 0), @ (seq -2), # (seq -1)
- Enqueues welcome system message for the new group
- Grants: tier 1 defaults from V-action-grants
- `notify()`: "Approved: <sender> → <folder>/"

### /reject <jid>

- Root-only
- Sets status to `rejected` in onboarding table
- No further notifications for this JID
- `notify()`: "Rejected: <jid>"

## State

```sql
CREATE TABLE onboarding (
  jid     TEXT PRIMARY KEY,
  status  TEXT NOT NULL,  -- pending | approved | rejected
  sender  TEXT,
  channel TEXT,
  created TEXT NOT NULL
);
```

Dedup: same JID notifies once. Pending JIDs silently dropped.
Rejected JIDs stay rejected until operator clears manually.

## Welcome system message

On approve, gateway enqueues a system message for the new
group (same mechanism as new-session, new-day):

```xml
<system origin="gateway" event="onboarding">
  <user id="tg-12345" jid="telegram:-12345" />
  <group folder="alice" tier="1" />
  <instructions>
    This is a new user's first interaction. Welcome them,
    explain what you can do, and show them how to get started.
    Be concise but helpful. Show 3-5 example prompts they
    can try.
  </instructions>
</system>
```

The agent processes this alongside the user's first message.
The agent's CLAUDE.md/SOUL.md defines the persona and
capabilities — the system message just triggers the welcome
behavior. Products customize welcome via their CLAUDE.md.

## Dashboard hooks

### Pending approvals in dash-status

The status dashboard (P-dash-status) shows pending onboarding
requests as a section:

```
Pending onboarding (2)
  telegram:-12345  alice      2m ago   /approve telegram:-12345
  discord:98765    bob        15m ago  /approve discord:98765
```

API endpoint: `GET /dash/api/onboarding` returns pending list.

### New group in dash-groups

After approval, the new group appears in the groups tree
(U-dash-groups) immediately. No dashboard-specific code —
it reads from the groups table which `/approve` already
populates.

## Permissions

### Who can approve/reject

Root-only (tier 0). Commands check `permissionTier === 0`
in their handler, same as other control commands.

### What the new group gets

On approval, the new world gets tier 1 defaults:

- **Routes**: default + predefined @ and # (S-topic-routing)
- **Grants**: tier 1 defaults from V-action-grants (platform
  access for all routed platforms, messaging, social actions)
- **Folder**: world-level (`alice/`), can create children
- **Container config**: inherited from prototype or default

The operator can customize grants after creation via
`/grant` command or dashboard.

### Restricting new groups

To give new groups fewer permissions (e.g., tier 2 behavior
on a tier 1 folder), add grant overrides:

```
/grant alice !post !react !set_profile
```

Or change the prototype's default grants.

## Module: `src/onboarding.ts`

Small, self-contained:

```typescript
export function enqueueOnboarding(jid: string, msg: InboundEvent): void;
export function approveOnboarding(jid: string, folder?: string): string;
export function rejectOnboarding(jid: string): void;
export function getPendingOnboarding(): OnboardingEntry[];
```

Uses `notify()` from `src/commands/notify.ts` for root
notifications. Uses `registerGroup()` for world creation.

## Not in scope

- Auto-approve (allowlist, rate limit)
- Invite link generation
- Multi-step approval
- Per-channel onboarding customization
- Onboarding for existing worlds (adding JIDs to existing groups)
