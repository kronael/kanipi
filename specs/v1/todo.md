# Specs to finish (v1)

## Specs complete, pending implementation

- **system-messages** (0%) — `system_messages` table, enqueue/flush in db.ts,
  flush in processGroupMessages, `new-session` injection with `<previous_session>`
  records, `sessions` history table; only inject `<messages>` on new session
- **memory-session** (~75%) — gateway error notification to user on `status:error`
- **message-threading / channels** (~5%) — `NewMessage.replyTo`, `SendOpts`,
  channel impls (telegram/whatsapp/discord), `<in_reply_to sender time ago>` in
  `formatMessages()`, `messages.raw` column for WAMessage
- **jid-hierarchy** (0%) — glob matching in group lookup, multi-segment JID
  construction in Discord and Telegram
- **commands** (~5%) — `/new` detection in gateway message loop

## Specs still open

- **cli.md** — partial

## Deferred to phase II

- **memory-diary** — silent PreCompact flush, periodic flush, SIGTERM hook
- **plugins.md** — plugin proposal/approval/deploy flow
- **db-bootstrap.md** — sessions history table expansion not yet reflected

## IPC gaps

- `reset_session` — not wired in `src/ipc.ts`

## Moved to v2

- `get_history` → `specs/v2/message-mcp.md`
