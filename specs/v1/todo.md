# Specs to finish (v1)

## Specced, pending implementation

- **worlds** (0%) -- JID separator, prefix expansion,
  isMain->isRoot, global/->share/, folder validation, glob
- **message-threading** (~5%) -- replyTo, SendOpts, channel
  impls, `<in_reply_to>`, messages.raw column. In channels.md
- **actions** -- registry unifying IPC/MCP/commands. actions.md
- **agent MCP self-registration** -- merge from settings.json,
  dynamic allowedTools. In extend-agent.md

## Still open

- **cli.md** -- partial
- **integration tests** -- testcontainers, mock agent. testing.md

## Reference specs (no code changes)

router.md, extend-gateway.md, extend-agent.md, channels.md,
mime.md

## Deferred to phase II

- **memory-diary** -- PreCompact flush, periodic, SIGTERM
- **db-bootstrap.md** -- sessions table expansion
- **mime formalization** -- full MessageEnricher interface

## Shipped

- **system-messages** -- tables, enqueue/flush, injection,
  session recording
- **commands** -- /new, /ping, /chatid registry
- **reset_session IPC**
- **memory-session** -- error notification, cursor rollback

## Moved to v2

- `get_history` -> `v2/message-mcp.md`
- Agent-side media -> `v2/workflows.md`
- IPC -> MCP proxy -> `v2/ipc-mcp-proxy.md`
- Systems -> `v2/systems.md` (#topics, @agents, workflows)
