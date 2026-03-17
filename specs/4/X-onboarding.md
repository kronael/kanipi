---
status: spec
---

# Onboarding

Hardcoded gateway flow for unrouted JIDs. No LLM, no
container, no group until approval. State machine in
`src/onboarding.ts`, state in `onboarding` table.

## User journey

1. User finds the bot, sends anything
2. No route — gateway sends welcome:
   "Hi! I'm <BOT_NAME>. To get started, request your
   own workspace: `/request <name>`"
3. User sends `/request alice-studio`
4. Bot validates, stores, notifies root:
   "Request received! Waiting for approval."
5. Operator approves — world created, route added
6. User sends next message — routes to their world
7. Agent wakes with welcome system message, runs
   `/hello` + `/howto`

## Admin journey

1. Enable: `ONBOARDING_ENABLED=1` in `.env`
2. Root gets notification: "alice wants 'alice-studio'
   — `/approve telegram:-12345`"
3. `/approve telegram:-12345` — creates world, routes JID
4. `/approve telegram:-12345 --proto support` — with prototype
5. `/reject telegram:-12345` — suppresses forever
6. Dashboard shows pending requests in status page

Root is LLM-driven — the root agent sees the notification
and can act on it. Configure via root's CLAUDE.md:

- **Manual** — agent relays to operator, operator types command
- **Suggest** — agent recommends prototype, operator confirms
- **Auto** — agent approves automatically (CLAUDE.md rules)

## How it works

No group, no folder, no container spawn. The gateway's
existing `!group` branch (index.ts:301) is the only hook:

```typescript
if (!group) {
  if (onboardingEnabled) {
    await handleOnboarding(chatJid, messages, channel);
    return true;
  }
  return true;
}
```

`handleOnboarding` is a state machine driven by the
onboarding table. Pure gateway code — `channel.sendMessage()`
responses, no LLM.

## State machine

```
message arrives, no route exists
  → look up jid in onboarding table

  no entry or status=new:
    → insert (status: new) if missing
    → send "Hi! I'm <BOT_NAME>. To get started, request
      your own workspace: /request <name>"

  new + message is "/request <name>":
    → validate name (a-z0-9-, not taken, not reserved)
    → invalid: send "Invalid name — lowercase letters, numbers, hyphens only"
    → valid: set status=pending, store world_name
    → notify() root: "alice wants 'alice-studio' — /approve telegram:-12345"
    → send "Request received! Waiting for approval."

  new + message is anything else:
    → send "To request a workspace: /request <name>"

  pending:
    → send "Still waiting for approval."

  rejected:
    → silence (or "This request was declined.")

  approved:
    → unreachable (route exists, !group branch never hit)
```

## State table

```sql
CREATE TABLE onboarding (
  jid        TEXT PRIMARY KEY,
  status     TEXT NOT NULL,  -- new | pending | approved | rejected
  sender     TEXT,
  channel    TEXT,
  world_name TEXT,
  created    TEXT NOT NULL
);
```

## Commands

Registered in `src/commands/` like `/status`:

### /approve <jid>

- Root-only (`permissionTier === 0`)
- Reads `world_name` from onboarding table
- Creates world folder: `groups/<world_name>/`
- Copies from root's `prototype/` dir (same mechanism as
  child group spawn — index.ts:527 — but using root as
  the prototype source for worlds). Root's `prototype/`
  defines what new worlds look like: CLAUDE.md, SOUL.md,
  skills, etc.
- Inserts group in DB (tier 1, no parent)
- Adds routes: default (seq 0), @ (seq -2), # (seq -1)
- Grants: tier 1 defaults (V-action-grants)
- Enqueues welcome system message
- Sets onboarding status to `approved`
- `notify()`: "Approved: alice → alice-studio/"

### /reject <jid>

- Root-only
- Sets status to `rejected`
- `notify()`: "Rejected: <jid>"

## Config

```
ONBOARDING_ENABLED=0              # off by default
```

## Welcome system message

On approve, gateway enqueues for the new group:

```xml
<system origin="gateway" event="onboarding">
  <user id="tg-12345" jid="telegram:-12345" />
  <group folder="alice-studio" tier="1" />
  <instructions>
    This is a new user's first interaction.
    1. Run /hello to welcome the user.
    2. Run /howto to build a getting-started web page for them.
  </instructions>
</system>
```

## Dashboard

Status page (P-dash-status) shows pending requests:

```
Pending onboarding (2)
  telegram:-12345  alice      2m ago   /approve telegram:-12345
  discord:98765    bob        15m ago  /approve discord:98765
```

API: `GET /dash/api/onboarding`

## Permissions

New world gets tier 1 defaults:

- Routes: default + predefined @ and # (S-topic-routing)
- Grants: tier 1 from V-action-grants
- Folder: world-level, can create children
- Container config: from prototype or default

Operator can restrict after creation: `/grant alice-studio !post`

## Module: `src/onboarding.ts`

```typescript
export async function handleOnboarding(
  chatJid: string,
  messages: InboundEvent[],
  channel: Channel,
): Promise<void>;
export function approveOnboarding(jid: string): string;
export function rejectOnboarding(jid: string): void;
export function getPendingOnboarding(): OnboardingEntry[];
```

## Not in scope

- Auto-approve (allowlist, rate limit)
- Multi-step onboarding (language, purpose, etc.)
- Onboarding for adding JIDs to existing worlds
