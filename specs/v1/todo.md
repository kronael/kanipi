# v1 specs — complete

All v1 specs are done. Pending implementation only.

## Pending implementation

- **worlds** -- JID separator, prefix expansion,
  isMain->isRoot, global/->share/, folder validation, glob
- **message-threading** -- replyTo, SendOpts, channel
  impls, `<in_reply_to>`, messages.raw column. In channels.md
- **actions** -- registry unifying IPC/MCP/commands. actions.md
- **agent MCP self-registration** -- merge from settings.json,
  dynamic allowedTools. In extend-agent.md
- **cli** -- cli.md
- **integration tests** -- testcontainers, mock agent. testing.md

## Reference specs (no code changes)

router.md, extend-gateway.md, extend-agent.md, channels.md,
mime.md, prompt-format.md, extend-skills.md

## Deferred to v2

- **memory-diary** -- PreCompact flush, periodic, SIGTERM
- **db-bootstrap** -- sessions table expansion
- **mime formalization** -- full MessageEnricher interface
- `get_history` -> `v2/message-mcp.md`
- Agent-side media -> `v2/workflows.md`
- IPC -> MCP proxy -> `v2/ipc-mcp-proxy.md`
- Systems -> `v2/systems.md` (#topics, @agents, workflows)

## Shipped

- **system-messages** -- tables, enqueue/flush, injection,
  session recording
- **commands** -- /new, /ping, /chatid registry
- **reset_session IPC**
- **memory-session** -- error notification, cursor rollback
