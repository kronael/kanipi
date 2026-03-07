# TODO

## v1m1 — next to ship

Partial specs, close to done. Finish these first.

- [ ] memory-facts: gateway injection + MCP tools (facts skill exists)
- [ ] paths: hostPath() elimination (HOST\_\* exports done)
- [ ] autotesting: IPC drain + voice roundtrip test gaps
- [ ] sse: per-sender scoping (basic broadcast works)
- [ ] worlds-rooms: phase 2 threads/rooms (phase 1 isRoot shipped)
- [ ] session-recovery: recovery notes on eviction
- [ ] work: /work skill, staleness detection
- [ ] errored chat flag: shipped this session (don't auto-retry on restart)

## v1m2 — outstanding, not urgent

- [ ] message-mcp: get_history/get_thread MCP tools
- [ ] agent-messaging: structured agent↔agent messages
- [ ] identities: cross-channel identity linking
- [ ] message-wal: pending_delivery table, ack protocol
- [ ] collapse sessions table into registered_groups.session_id
- [ ] test SDK resume failure (bad session ID behavior)

## v2m1 — memory layers, agent teams, feed adapters

- [ ] memory-episodic: diary → weekly/monthly aggregation
- [ ] agent-teams: multi-agent collaboration
- [ ] agent-pipeline: continuation payload, multi-hop routing
- [ ] ipc-mcp-proxy: unix socket, replace file IPC
- [ ] plugins: dynamic channel/feature loading
- [ ] workflows: multi-step workflow primitives
- [ ] feed adapters: reddit, twitter, facebook, gmail, webdav
- [ ] HTTP request scrubbing (strip secrets from agent HTTP)

## v2m2 — Go rewrite

- [ ] Go gateway rewrite (specs/v2m2/architecture.md)
- [ ] arizuka integration

## atlas

- [ ] user context: per-user memory, gateway injection
- [ ] semantic search: embeddings MCP sidecar
- [ ] gateway fact injection (top-N relevant)
- [ ] knowledge gap detection → auto-trigger research
- [ ] scheduled research (cron)
- [ ] v2 sandboxed support: frontend/backend split (specs/atlas/v2-sandboxed-support.md)
