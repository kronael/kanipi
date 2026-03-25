---
status: planned
---

# Message Scoping

## Problem

All messages are saved unconditionally. But access and triggering
are conflated — routing a JID causes the agent to fire. There is
no way to say "save these messages to a group's scope without
triggering an agent run."

## Route types: store vs default

Add `store` as a route type:

| Route type | Saved | Scoped to group | Triggers agent |
| ---------- | ----- | --------------- | -------------- |
| none       | ✓     | root only       | ✗              |
| `store`    | ✓     | group           | ✗              |
| `default`  | ✓     | group           | ✓              |

`store` routes are evaluated like `default` for message scoping
but excluded from the poll loop that drives agent invocation.

## Implementation

`getRoutedJids()` returns JIDs with any route. Split into:

- `getTriggerJids()` — JIDs with at least one `default` route
- `getStoreJids()` — JIDs with only `store` routes

The message loop polls `getTriggerJids()` for agent dispatch.
`getStoreJids()` are polled only for metadata updates (chat name,
last seen) — never for agent triggering.

`routeMatches` gains a `store` case: always matches, never
delegates to agent. Evaluation order: store has lowest priority
(seq 9999 by convention, like platform wildcards).

## Access control: DENY not filter

When an agent queries messages via MCP/IPC, scope is enforced
strictly — not by silently filtering results, but by denying
the request outright if the requested JID is outside the agent's
group scope.

**Scope**: a group can access messages where `routes.target`
includes the group's folder or any ancestor folder the group
inherits from.

**Violation response** (not an empty result):

```json
{
  "error": "access_denied",
  "message": "You can only query messages routed to your group (atlas/content). Request a root operator to grant cross-group access."
}
```

The denial is returned to the agent as a tool error, not a silent
empty list. This makes authorization failures visible rather than
producing subtly wrong behavior.

## Platform wildcard routes

`discord:` (no channel ID) as a `store` route sends all Discord
messages to a group's scope without triggering any agent. Specific
channel JIDs can have `default` routes that do trigger.

```sql
-- Store all Discord messages in atlas/content scope, no trigger
INSERT INTO routes (jid, type, seq, target)
VALUES ('discord:', 'store', 9999, 'atlas/content');

-- Trigger agent for a specific Discord channel
INSERT INTO routes (jid, type, seq, target)
VALUES ('discord:1234567890', 'default', 0, 'atlas/content');
```

## Schema

No schema change. `routes.type` already accepts arbitrary strings.
`store` is a new valid value handled in code.

## MCP enforcement location

Message query actions (IPC `get_messages`, MCP `read_messages`):

1. Resolve caller's group folder from container context
2. Look up routes for requested JID — check `target` includes caller's folder
3. If not: return `access_denied` error (above)
4. If yes: return messages

Root group (`folder = 'root'`, tier 0) bypasses scope check — sees all.
