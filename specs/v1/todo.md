# Specs to finish (v1)

## Specs complete, pending implementation

- **message-threading / channels** (~5%) — `NewMessage.replyTo`, `SendOpts`,
  channel impls (telegram/whatsapp/discord), `<in_reply_to sender time ago>` in
  `formatMessages()`, `messages.raw` column for WAMessage
- **jid-hierarchy** (0%) — glob matching in group lookup, multi-segment JID
  construction in Discord and Telegram

## Specs still open

- **cli.md** — partial

## Deferred to phase II

- **memory-diary** — silent PreCompact flush, periodic flush, SIGTERM hook
- **plugins.md** — plugin proposal/approval/deploy flow
- **db-bootstrap.md** — sessions history table expansion not yet reflected

## Shipped

- **system-messages** ✓ — `system_messages` + `sessions` tables, enqueue/flush,
  `new-session` + `new-day` injection, session recording in container-runner
- **commands** ✓ — `/new`, `/ping`, `/chatid` command registry (`src/commands/`),
  migrated from telegram hardcoding
- **reset_session IPC** ✓ — wired in `src/ipc.ts`
- **memory-session** ✓ — error notification to user on agent error, cursor rollback for retry

## Moved to v2

- `get_history` → `specs/v2/message-mcp.md`
