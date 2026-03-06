# Specs to finish (v1)

## Specs complete, pending implementation

- **worlds** (0%) — JID separator migration, prefix expansion,
  isMain→isRoot, global/→share/, folder validation, glob router
- **message-threading** (~5%) — `NewMessage.replyTo`, `SendOpts`,
  channel impls (telegram/whatsapp/discord), `<in_reply_to>` in
  `formatMessages()`, `messages.raw` column for WAMessage.
  Specced in channels.md.
- **actions** — action registry unifying IPC dispatch, MCP tools,
  and commands. Spec complete in actions.md.
- **agent MCP self-registration** — agent-runner merges MCP servers
  from settings.json, dynamic allowedTools. Two changes in
  agent-runner/src/index.ts + gateway settings preservation.
  Specced in extend-agent.md.

## Specs still open

- **agents & topics routing** — route telegram forum topics and
  discord threads to correct agent containers. Topic/thread ID
  as JID segment, glob patterns match topic families.
  Builds on worlds router.
- **cli.md** — partial
- **integration tests** — testcontainers harness, mock agent image,
  slink scenarios. Specced in testing.md.

## Reference specs (no code changes)

- **router** — router.md. Current flow, mounts, prompt assembly.
- **extend** — extend.md. Gateway registry reference for developers.
- **extend-agent** — extend-agent.md. Agent self-extension via SDK.
- **channels** — channels.md. Full interface spec, coverage matrix.
- **mime** — mime.md. Pipeline spec, mostly shipped.

## Deferred to phase II

- **memory-diary** — silent PreCompact flush, periodic flush, SIGTERM hook
- **db-bootstrap.md** — sessions history table expansion not yet reflected
- **mime pipeline formalization** — full `MessageEnricher` interface.
  Current handler array works for v1.

## Shipped

- **system-messages** — `system_messages` + `sessions` tables,
  enqueue/flush, `new-session` + `new-day` injection, session
  recording in container-runner
- **commands** — `/new`, `/ping`, `/chatid` command registry
  (`src/commands/`), migrated from telegram hardcoding
- **reset_session IPC** — wired in `src/ipc.ts`
- **memory-session** — error notification to user on agent error,
  cursor rollback for retry

## Moved to v2

- `get_history` → `specs/v2/message-mcp.md`
- Agent-side media processing via MCP → `specs/v2/workflows.md`
