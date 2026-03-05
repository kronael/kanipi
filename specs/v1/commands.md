# Commands — open (v1)

Gateway-intercepted commands. Pluggable registry, channel-aware,
agent-discoverable. Not yet implemented.

## Design principles

Like the mime pipeline — each command is a self-contained handler,
registered in a registry, not hardcoded into `index.ts`. New commands
can be added without touching core routing code.

Two additional requirements beyond mime:

1. **Channel capability** — channels declare whether they support
   native commands (Telegram: yes, WhatsApp: no). The registry uses
   this to register commands natively where possible (Telegram slash
   commands, Discord slash commands) and fall back to text prefix
   matching elsewhere.

2. **Agent discoverability** — the agent can query what commands exist
   and what they do, so it can instruct users correctly per channel.
   "On Telegram you can use `/new`. On WhatsApp, just type `/new`."

## Command handler shape

```typescript
interface CommandHandler {
  name: string; // "new"
  description: string; // "Start a fresh session"
  usage?: string; // "/new" or "/new [reason]"
  handle(ctx: CommandContext): Promise<void>;
}

interface CommandContext {
  group: RegisteredGroup;
  message: NewMessage;
  channel: Channel;
  args: string; // everything after the command word
}
```

Handlers live in `src/commands/` — one file per command, same pattern
as `src/mime-handlers/`. Loaded and registered at startup.

## Channel capability declaration

Each channel declares `supportsNativeCommands: boolean` and optionally
`registerCommands(handlers: CommandHandler[])` — called at startup to
register with the channel's native command API (grammy, Discord REST).

```
Telegram   → supportsNativeCommands: true  → registers with grammy
Discord    → supportsNativeCommands: true  → registers via REST API
WhatsApp   → supportsNativeCommands: false → text prefix only
Email      → supportsNativeCommands: false → subject prefix only
Slink      → supportsNativeCommands: false → body prefix only
```

Gateway loop intercepts `/word` prefix on all channels regardless —
native registration is additive, not a replacement.

## Agent discoverability

Gateway writes `commands.json` to the group IPC directory on startup
(updated when registry changes):

```json
[
  { "name": "new", "description": "Start a fresh session", "usage": "/new" },
  { "name": "ping", "description": "Check bot status", "usage": "/ping" }
]
```

Agent reads this file to know what commands exist and how to describe
them to users. Per-channel phrasing is the agent's responsibility —
it knows which channel it is on from the message context.

Pull side: agent can also call an MCP tool `list_commands()` once that
infrastructure exists (v2 territory).

## v1 commands

| Command   | Effect                                                                |
| --------- | --------------------------------------------------------------------- |
| `/new`    | Clear stored session ID → next spawn starts fresh, sends confirmation |
| `/ping`   | Reply with bot name + online status                                   |
| `/chatid` | Reply with the channel JID for this chat                              |

## Current state (before this spec ships)

Telegram: `/chatid` and `/ping` hardcoded in `src/channels/telegram.ts`,
all other `/` messages dropped silently. No other channel has commands.
This spec replaces that with the registry approach.

## Open

- `src/commands/` directory and handler interface
- Channel `supportsNativeCommands` + `registerCommands` on the `Channel`
  interface (see `specs/v1/channels.md`)
- `commands.json` IPC snapshot written at startup
- `/help` command — lists all registered commands for this group
- Agent-registered commands: agent adds entries via IPC, gateway routes
  matching messages back as structured input (see `specs/v2/agent-routing.md`)
- Discord slash command registration (currently nothing registered)
