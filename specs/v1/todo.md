# Specs to finish (v1)

## Unshipped code

- **system-messages** (0%) — `system_messages` table, enqueue/flush in db.ts,
  flush in processGroupMessages, `new-session` injection with `<previous_session>`
  records, `sessions` history table
- **memory-session** (~75%) — gateway error notification to user on `status:error`
- **message-threading** (~5%) — `NewMessage.replyTo`, `SendOpts`, channel impls
  (telegram/whatsapp/discord), `reply_to` in `formatMessages()`
- **commands.md** (~5%) — `/new` detection in gateway message loop
- **memory-diary** (~25%) — silent PreCompact flush, periodic flush every N turns
- **plugins.md** (open)
- **cli.md** (partial)

## IPC / MCP gaps

- `get_history` — agent query into `messages` DB (IPC or MCP tool); specced in
  `systems.md`, not implemented
- `reset_session` IPC message — not wired in `src/ipc.ts`

## Open spec questions

- `prompt-format.md` — `reply_to` attr on `<message>` not emitted
- `memory-messages.md` — session/DB history overlap unresolved
