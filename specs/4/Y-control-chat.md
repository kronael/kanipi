---
status: spec
---

# Control Chat

Gateway ↔ operator communication via the root group's chat.
No dedicated `CONTROL_JID` — root's JIDs from the routing table
are the control channel. Commands use the existing command
registry (`src/commands/`), not a separate dispatcher.

## Design

The root group is the control chat. Messages to root follow
normal routing. Gateway commands (`/status`, `/approve`, etc.)
are intercepted before the container run — same as `/new`,
`/stop`, `/ping`. Non-command messages proceed to the root
agent normally.

## Gateway → operator (notifications)

`notify(text)` in `src/commands/notify.ts`:

- Looks up root's JIDs via `getJidsForFolder('root')`
- Sends to each via `channel.sendMessage(jid, text)`
- Records via `storeOutbound({ source: 'control' })`

Examples:

- Onboarding: "New: alice via telegram:-12345"
- Errors: "Container timeout for atlas/"
- Health: "Channel discord reconnected after 5m"

## Operator → gateway (commands)

Registered in `src/commands/` like existing commands.
Root-only commands check tier inside their handler.

See `specs/1/6-commands.md` for the full command table.

## Not in scope

- Multi-operator (future — role-based access)
- Audit log of control commands (covered by Z-audit-log)
- Bot command menus (telegram setMyCommands etc.)
