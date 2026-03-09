# TODO

also - consider a re-pathing.. where the standard unix layout would map to
the groups . ... unifying workspace with ~/ homes and the http multi-tenancy
would become .publick_html like system

- all of this then injects and reflect onto itself of not reinventing the worls

## Phase 2 — next to ship

Partial specs, close to done. Finish these first.

- [ ] paths: hostPath() elimination (HOST\_\* exports done)
- [ ] autotesting: IPC drain + voice roundtrip test gaps
- [x] session-recovery: diary recovery entries on error/crash
- [ ] errored chat flag: shipped this session (don't auto-retry on restart)
- [ ] sse: auth per group on stream endpoint (broadcast is correct)
- [x] diary: stop hook nudge, precompact cleanup, 14-entry injection, CLAUDE.md updates

## Phase 3 — outstanding, not urgent

- [ ] worlds-rooms: phase 2 threads/rooms (phase 1 isRoot shipped)
- [ ] memory-facts: gateway injection + MCP tools (facts skill exists)
- [ ] message-mcp: get_history/get_thread MCP tools
- [ ] agent-messaging: structured agent-to-agent messages
- [ ] identities: cross-channel identity linking
- [ ] message-wal: pending_delivery table, ack protocol
- [ ] collapse sessions table into registered_groups.session_id
- [ ] test SDK resume failure (bad session ID behavior)

## Phase 3 — dashboards & file access

- [ ] dash-status: health dashboard (containers, queues, errors)
- [ ] dash-memory: memory/diary viewer and editor
- [ ] webdav: WebDAV file access via Caddy sidecar

## Future — memory layers, agent teams, feed adapters

- [ ] memory-episodic: diary -> weekly/monthly aggregation
- [ ] agent-teams: multi-agent collaboration
- [ ] agent-pipeline: continuation payload, multi-hop routing
- [ ] ipc-mcp-proxy: unix socket, replace file IPC
- [ ] plugins: dynamic channel/feature loading
- [ ] workflows: multi-step workflow primitives
- [ ] evangelist: reddit engagement agent (scrape, score, draft, review, post)
- [ ] feed adapters: twitter, facebook, gmail
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
