# TODO

## atlas — phase 1 (viability)

- [x] facts search: `/facts <query>` skill, grep-based
- [x] researcher: subagent workflow, writes to facts/
- [ ] user context: per-user memory files, gateway injection (specs/atlas/user-context.md)
- [x] group add CLI bug: stomps existing groups on same folder

## atlas — phase 2 (quality)

- [ ] semantic search: embeddings MCP sidecar (nomic-embed-text)
- [ ] fact confidence tiers + ranked injection
- [x] verifier: second-pass subagent in /facts skill
- [ ] knowledge gap detection → auto-trigger research
- [ ] scheduled research (cron)

## v1 specs — shipped

- [x] voice (whisper sidecar, transcription pipeline) — specs/v1/voice.md
- [x] memory-managed (CLAUDE.md + MEMORY.md per group) — specs/v1/memory-managed.md
- [x] agent-routing (5 rule types, delegation, depth limit) — specs/v1/agent-routing.md
- [x] auth (local argon2 + JWT + refresh) — specs/v1/auth-oauth.md (OAuth deferred)
- [x] files (outbound send_file) — specs/v1/files.md (upload validation deferred)
- [x] output styles (telegram, discord, email) — per-channel SDK styles
- [x] session continuity (diary read on new session) — container/CLAUDE.md
- [x] fact staleness (auto-refresh >14d facts) — container/CLAUDE.md
- [x] JID prefix migration (tg:→telegram:, dc:→discord:, bare→whatsapp:)
- [x] mount CLI (kanipi config <inst> mount {list|add|rm})

## v3 specs — partial

- [ ] worlds-rooms: phase 1 isRoot shipped, phase 2 threads/rooms not started
- [ ] sse: basic broadcast works, per-sender scoping missing
- [ ] memory-facts: facts skill exists, gateway injection + MCP tools missing
- [ ] paths: HOST\_\* exports done, hostPath() elimination remaining
- [ ] autotesting: unit/e2e tests exist, IPC drain + voice roundtrip gaps

## v3 specs — not started

- [ ] agent-pipeline: continuation payload, multi-hop routing
- [ ] ipc-mcp-proxy: gateway MCP server, unix socket, replace file IPC
- [ ] identities: cross-channel identity linking
- [ ] session-recovery: recovery notes on eviction
- [ ] message-mcp: get_history/get_thread MCP tools
- [ ] message-wal: pending_delivery table, ack protocol
- [ ] plugins: dynamic channel/feature loading
- [ ] workflows: multi-step workflow primitives
- [ ] work: /work skill, staleness detection
- [ ] memory-episodic: scheduled diary→weekly→monthly aggregation

## v3 channels — not started

- [ ] reddit (snoowrap) — specs/v3/reddit.md
- [ ] facebook (fca-unofficial) — specs/v3/facebook.md
- [ ] twitter (agent-twitter-client) — specs/v3/twitter.md
- [ ] gmail (API + Pub/Sub) — specs/v3/gmail.md
- [ ] webdav (Caddy sidecar) — specs/v3/webdav.md

## memory

- collapse `sessions` table into `registered_groups.session_id` column (see specs/v1/db-bootstrap.md)
- test SDK resume failure: send bad session ID to container, observe whether SDK throws / errors / silently starts fresh — record result in specs/v1/memory-session.md open item 1
- v3: HTTP request scrubbing (strip secrets from outbound agent HTTP calls)

## feed adapter (phase 1, all feed channels)

- synthetic inbound: dm / mention / timeline_post / reply_to_us event types
- outbound: reply / repost / react / post action types
- per-adapter watch config (accounts, keywords, subreddits)

## phase 2 (defer)

- MCP tools for deep querying: browse threads, search, follow, trending
- bus question: study HTTP proxying + MCP HTTP vs message bus before speccing
- mount allowlist UX (see specs/v1/isolation.md open questions)
