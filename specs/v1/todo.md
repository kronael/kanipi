# v1 specs — complete

All v1 specs are done. Implementation shipped in v0.5.0.

## Shipped (v0.5.0)

- **actions** -- action registry, request-response IPC,
  tool discovery manifest, actions/\* modules
- **agent MCP self-registration** -- settings.json merge,
  dynamic allowedTools wildcards
- **message-threading** -- SendOpts, replyTo types added

## Shipped (v0.4.0)

- **worlds** -- isRoot, share/, folder validation

## Shipped (earlier)

- **system-messages** -- tables, enqueue/flush, injection,
  session recording
- **commands** -- /new, /ping, /chatid registry
- **reset_session IPC**
- **memory-session** -- error notification, cursor rollback

## Reference specs (no code changes)

router.md, extend-gateway.md, extend-agent.md, channels.md,
mime.md, prompt-format.md, extend-skills.md

## Remaining (not blocking release)

- **cli** -- TS rewrite of bash entrypoint (bash works fine)
- **integration tests** -- testcontainers, mock agent
- **message-threading channel impls** -- replyTo in channel
  sendMessage (types shipped, impls deferred)

## Deferred to v2

- **memory-diary** -- PreCompact flush, periodic, SIGTERM
- **db-bootstrap** -- sessions table expansion
- **mime formalization** -- full MessageEnricher interface
- `get_history` -> `v2/message-mcp.md`
- Agent-side media -> `v2/workflows.md`
- IPC -> MCP proxy -> `v2/ipc-mcp-proxy.md`
- Systems -> `v2/systems.md` (#topics, @agents, workflows)
