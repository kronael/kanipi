# Specs to finish (v1)

## Specs complete, pending implementation

- **worlds** (0%) — JID separator migration, prefix expansion,
  isMain→isRoot, global/→share/, folder validation, glob router
- **message-threading** (~5%) — `NewMessage.replyTo`, `SendOpts`,
  channel impls (telegram/whatsapp/discord), `<in_reply_to>` in
  `formatMessages()`, `messages.raw` column for WAMessage.
  Specced in channels.md.

## Specs still open

- **actions** (~80%) — action registry unifying IPC dispatch,
  MCP tools, and commands. Spec complete, pending implementation.
- **agents & topics routing** — route telegram forum topics and
  discord threads to correct agent containers. Topic/thread ID
  as JID segment, glob patterns match topic families.
  Builds on worlds router.
- **agent MCP self-registration** — specced in extend-agent.md.
  Agent-runner merges MCP servers from settings.json, dynamic
  allowedTools. Two changes in agent-runner/src/index.ts.
  Gateway must preserve agent's mcpServers in settings injection.
- **router** — specced in router.md. Current flow documented,
  open items (glob routing, formatMessages improvements) depend on
  worlds and channels specs shipping first.
- **cli.md** — partial
- **integration tests** — testcontainers harness, mock agent image,
  slink scenarios. Specced in testing.md.

## Deferred to phase II

- **memory-diary** — silent PreCompact flush, periodic flush, SIGTERM hook
- **db-bootstrap.md** — sessions history table expansion not yet reflected
- **mime pipeline** — `specs/v1/mime.md` describes full
  `MessageEnricher` interface, parallel execution, `ContextAnnotation`.
  Current code (`mime-enricher.ts` + handler array) works fine for v1.
  Formalize when a third handler is needed.

## Shipped

- **system-messages** ✓ — `system_messages` + `sessions` tables, enqueue/flush,
  `new-session` + `new-day` injection, session recording in container-runner
- **commands** ✓ — `/new`, `/ping`, `/chatid` command registry (`src/commands/`),
  migrated from telegram hardcoding
- **reset_session IPC** ✓ — wired in `src/ipc.ts`
- **memory-session** ✓ — error notification to user on agent error, cursor rollback for retry

## Moved to v2

- `get_history` → `specs/v2/message-mcp.md`
