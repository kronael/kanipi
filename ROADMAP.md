# ROADMAP

Specs live in `specs/<phase>/`. See TODO.md for task-level tracking.

## Phase 1 — shipped

Functional multi-channel agent gateway.

- 5 channels: Telegram, WhatsApp, Discord, Email, Web/Slink
- Containerized Claude Code agents (docker, stdin/stdout JSON)
- Group routing + delegation (5 rule types, depth limit)
- Skills system (diary, migrate, facts researcher)
- Voice transcription (whisper service)
- File I/O (send/receive documents, images, audio, video)
- Per-channel output styles (telegram, discord, email, web)
- Action registry (Zod schemas, authorization)
- IPC: signal-driven file protocol (SIGUSR1 wake)
- Scheduled tasks (cron)
- Auth (argon2 + JWT)
- Session continuity (diary injection on new session)
- JID normalization (telegram:, whatsapp:, discord:, email:, web:)
- Mount security (allowlist outside project dir)

## Phase 2 — next to ship

Partial work, close to done. `specs/2/`

- memory-facts: gateway injection + MCP tools
- autotesting: IPC drain + voice roundtrip gaps
- sse: per-sender scoping
- worlds-rooms: phase 2 threads/rooms
- session-recovery: recovery notes on eviction
- work: /work skill, staleness detection

## Phase 3 — outstanding, not urgent

`specs/3/`

- message-mcp: get_history/get_thread MCP tools
- agent-messaging: structured agent-to-agent messages
- identities: cross-channel identity linking
- message-wal: pending_delivery table, ack protocol

## Phase 4-6 — products

`specs/4/`, `specs/5/`, `specs/6/`

- agent-media-awareness (phase 4)
- evangelist (phase 5)
- cheerleader (phase 6)

## Future — memory layers, agent teams, feed adapters

New subsystems and channel types.

- memory-episodic: diary aggregation to weekly/monthly
- agent-teams: multi-agent collaboration
- agent-pipeline: continuation payload, multi-hop routing
- ipc-mcp-proxy: unix socket, replace file IPC
- plugins: dynamic channel/feature loading
- workflows: multi-step workflow primitives
- feed adapters: reddit, twitter, facebook, gmail, webdav

## Future — Go rewrite

Gateway rewrite in Go. Agent container stays TypeScript.

- Single static binary, no node_modules
- Native concurrency (goroutines vs polling loops)
- Same SQLite schema, same .env, same IPC protocol
- Drop-in replacement for TS gateway

## Atlas

Product-specific roadmap.

- User context: per-user memory, gateway injection
- Semantic search: embeddings MCP server
- Gateway fact injection (top-N relevant)
- v2 sandboxed support: frontend/backend agent split
