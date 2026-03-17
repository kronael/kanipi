---
status: spec
---

# Onboarding

When a message arrives from an unrouted JID, notify root for
approval. On approval, create a world and route the JID to it.

## Flow

```
message from unknown JID
  → gateway finds no group (index.ts:298)
    → if ONBOARDING_ENABLED: inject to root
      → "New: alice via telegram:-12345. /approve or /reject"
        → root replies /approve
          → gateway creates world folder (alice/)
            → adds default route: JID → alice/
              → next message processes normally
```

## Config

```
ONBOARDING_ENABLED=1              # off by default
ONBOARDING_TARGET=root            # folder that gets notifications
ONBOARDING_PROTOTYPE=             # optional: clone from prototype
```

## Implementation

One hook point: `index.ts:processGroupMessages`, where
`!group` currently logs and returns. Instead:

```typescript
if (!group && onboardingEnabled) {
  enqueueOnboarding(chatJid, lastMessage);
  return true;
}
```

`src/onboarding.ts` — small module:

- `enqueueOnboarding(jid, msg)` — dedup by JID, inject
  notification to target folder with sender info
- `approveOnboarding(jid, worldName?)` — create folder,
  add default route, optionally clone prototype
- `rejectOnboarding(jid)` — mark rejected (don't re-notify)

Approval via commands (registered in command registry):

- `/approve` — approve pending JID from context
- `/reject` — reject and suppress future notifications

## State

Pending/rejected JIDs stored in DB:

```sql
CREATE TABLE onboarding (
  jid     TEXT NOT NULL PRIMARY KEY,
  status  TEXT NOT NULL,  -- 'pending', 'approved', 'rejected'
  sender  TEXT,           -- display name if available
  channel TEXT,           -- platform prefix
  created TEXT NOT NULL   -- ISO timestamp
);
```

## Dedup

Same JID notifies root once. Subsequent messages from a
pending JID are silently dropped until approved/rejected.
Rejected JIDs stay rejected until manually cleared.

## World creation

On approve:

1. Derive folder name from sender name or JID (slugified)
2. `mkdir groups/<folder>/`
3. If prototype set: copy prototype contents
4. `register_group` in DB
5. `add_route`: JID → folder (type: default)
6. Reply to root: "Created world <folder> for <jid>"

## Not in scope

- Auto-approve (future — rate limit + allowlist)
- Invite link generation (channels handle this natively)
- Multi-step approval flows
- Onboarding customization per channel
