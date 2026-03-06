# Commands -- open (v1)

Gateway-intercepted commands. Pluggable registry,
channel-aware, agent-discoverable.

## Command handler

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
  args: string;
}
```

Handlers in `src/commands/` — one file per command.

## Channel capability

```
Telegram   → native: true  → registers with grammy
Discord    → native: true  → registers via REST API
WhatsApp   → native: false → text prefix only
Email      → native: false → subject prefix only
Slink      → native: false → body prefix only
```

Gateway intercepts `/word` prefix on all channels regardless.

## Agent discoverability

Gateway writes `commands.xml` to group IPC dir at startup:

```xml
<commands>
  <command name="new" description="Start a fresh session"
           usage="/new" />
  <command name="ping" description="Check bot status"
           usage="/ping" />
</commands>
```

XML for prompt context (see `specs/xml-vs-json-llm.md`).
Agent reads to know what commands exist. Pull side:
`list_commands()` MCP tool (v2).

## v1 commands

| Command   | Effect                                |
| --------- | ------------------------------------- |
| `/new`    | Reset session; enqueue system message |
| `/ping`   | Reply with bot name + online status   |
| `/chatid` | Reply with the channel JID            |

Commands reach the agent via system message queue
(`system-messages.md`), never by triggering directly.

### `/new` — session reset

1. Send confirmation to user
2. Clear stored session ID
3. Enqueue system message `origin="command:/new"`
4. Args after `/new` become pending user message,
   flushed with system message on next turn

## Current state

Telegram: `/chatid` and `/ping` hardcoded. This spec
replaces that with the registry approach.

## Open

- `src/commands/` directory and handler interface
- Channel `supportsNativeCommands` + `registerCommands`
  on `Channel` interface (see `channels.md`)
- `commands.json` IPC snapshot at startup
- `/help` command
- Agent-registered commands via IPC (v2)
- Discord slash command registration
