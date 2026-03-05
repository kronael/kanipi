# Commands — open (v1)

Gateway-intercepted commands that act before the agent sees a message.
Cross-channel: handled in the gateway message loop regardless of channel.

## Current state

Telegram only: `/chatid` and `/ping` handled natively by grammy in
`src/channels/telegram.ts`. All other `/` messages dropped silently.
Discord, WhatsApp, email, slink: no command handling.

## Design

Commands are matched on the `NewMessage.content` field after all channels
normalize their input. Detection happens in `src/index.ts` before routing
to the agent — one place, works for all channels.

A command is a message whose content is exactly `/word` or `/word args`.

Channel-native registration (Telegram slash commands, Discord slash commands)
is additive — the same handler fires from both paths.

## v1 commands

| Command   | Handler | Effect                                                           |
| --------- | ------- | ---------------------------------------------------------------- |
| `/new`    | Gateway | Clear stored session ID for this group → next spawn starts fresh |
| `/ping`   | Gateway | Reply with bot name + online status                              |
| `/chatid` | Gateway | Reply with the channel JID for this chat                         |

`/new` sends a confirmation message to the user before the next agent
spawn, so the user knows the session was reset.

## Implementation

In `src/index.ts`, before enqueuing a message:

```typescript
if (content.startsWith('/')) {
  const handled = await handleCommand(group, message, channel);
  if (handled) return;
}
```

`handleCommand` dispatches on the command word, executes gateway-side
effects (clear session ID, reply), returns `true` if consumed.

Telegram keeps its existing native command registration in `telegram.ts`
for `/ping` and `/chatid` (these fire before `onMessage` so they never
reach the gateway loop).

## Open

- Define command registry so commands can be added without touching
  `index.ts` — e.g. each command is a `{ match, handle }` object
- `/help` — list available commands
- Agent-defined commands: agent registers custom commands via IPC,
  gateway routes them back to agent as structured input (v2 territory)
- Discord slash command registration (`REST.put(Routes.applicationCommands)`)
  — currently no slash commands registered
