---
status: spec
---

# Control Chat

A designated channel chat for gateway ↔ operator communication.
The gateway sends system notifications here (not agent-generated).
The operator replies with commands that route directly to gateway
handling, bypassing agents entirely.

## Concept

Today all chats route to agent groups. The control chat is
different: it's a direct line to the gateway itself. Messages
from the gateway are system events. Messages from the operator
are gateway commands.

```
gateway → control chat: "New user alice via telegram:-12345"
operator → control chat: "/approve alice"
gateway → control chat: "Created world alice/, routed telegram:-12345"
```

## Config

```
CONTROL_JID=telegram:-100xxx   # which chat is the control chat
```

Single JID. If unset, control chat is disabled — system
notifications go to logs only.

## Gateway → operator (notifications)

The gateway sends messages directly to the control chat via
the channel's sendMessage, not through any agent. Examples:

- Onboarding: "New: alice via telegram:-12345"
- Errors: "Container timeout for atlas/ on telegram:-100xxx"
- Deploys: "Agent image updated, 3 containers recycled"
- Health: "Channel discord reconnected after 5m downtime"

Notifications are fire-and-forget. No DB queue needed — just
`sendMessage(CONTROL_JID, text)`.

## Operator → gateway (commands)

Messages to CONTROL_JID are intercepted before routing.
They go to a command dispatcher, not an agent:

- `/approve <jid|name>` — approve onboarding
- `/reject <jid|name>` — reject onboarding
- `/status` — brief health summary
- `/restart <folder>` — restart a group's container
- `/grant <folder> <rule>` — add a grant override

Commands are synchronous — gateway processes and replies
in the same chat. No container spawned.

## Implementation

In `index.ts:processGroupMessages`, before route resolution:

```typescript
if (chatJid === CONTROL_JID) {
  handleControlMessage(lastMessage);
  return true;
}
```

`src/control.ts` — small module:

- `notify(text)` — send to CONTROL_JID if configured
- `handleControlMessage(msg)` — parse command, dispatch, reply
- Command registry: map of `/command` → handler function

## Integration with onboarding

X-onboarding uses `notify()` instead of its own injection
mechanism. Approval commands live in the control command
registry. The onboarding module registers its commands
(`/approve`, `/reject`) with the control dispatcher.

## Not in scope

- Multi-operator (future — role-based access)
- Control chat via web dashboard (future — API equivalent)
- Audit log of control commands (future)
- Bot command menus (telegram setMyCommands etc.)
