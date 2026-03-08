# TODO

## Phase 2 — next to ship

Partial specs, close to done. Finish these first.

- [ ] paths: hostPath() elimination (HOST\_\* exports done)
- [ ] autotesting: IPC drain + voice roundtrip test gaps
- [ ] session-recovery: recovery notes on eviction
- [ ] errored chat flag: shipped this session (don't auto-retry on restart)
- [ ] sse: auth per group on stream endpoint (broadcast is correct)
- [ ] work: /work skill, staleness detection

## Phase 3 — outstanding, not urgent

- [ ] worlds-rooms: phase 2 threads/rooms (phase 1 isRoot shipped)
- [ ] memory-facts: gateway injection + MCP tools (facts skill exists)
- [ ] message-mcp: get_history/get_thread MCP tools
- [ ] agent-messaging: structured agent-to-agent messages
- [ ] identities: cross-channel identity linking
- [ ] message-wal: pending_delivery table, ack protocol
- [ ] collapse sessions table into registered_groups.session_id
- [ ] test SDK resume failure (bad session ID behavior)

## Future — memory layers, agent teams, feed adapters

- [ ] memory-episodic: diary -> weekly/monthly aggregation
- [ ] agent-teams: multi-agent collaboration
- [ ] agent-pipeline: continuation payload, multi-hop routing
- [ ] ipc-mcp-proxy: unix socket, replace file IPC
- [ ] plugins: dynamic channel/feature loading
- [ ] workflows: multi-step workflow primitives
- [ ] feed adapters: reddit, twitter, facebook, gmail, webdav
- [ ] HTTP request scrubbing (strip secrets from agent HTTP)

## Future — Go rewrite

- [ ] Go gateway rewrite
- [ ] arizuka integration

## Atlas

- [ ] user context: per-user memory, gateway injection
- [ ] semantic search: embeddings MCP sidecar
- [ ] gateway fact injection (top-N relevant)
- [ ] knowledge gap detection -> auto-trigger research
- [ ] scheduled research (cron)
- [ ] v2 sandboxed support: frontend/backend split
