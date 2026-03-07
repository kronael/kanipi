# ROADMAP

## v1 — shipped

Functional multi-channel agent gateway.

- 5 channels: Telegram, WhatsApp, Discord, Email, Web/Slink
- Containerized Claude Code agents (docker, stdin/stdout JSON)
- Group routing + delegation (5 rule types, depth limit)
- Skills system (diary, migrate, facts researcher)
- Voice transcription (whisper sidecar)
- File I/O (send/receive documents, images, audio, video)
- Per-channel output styles (telegram, discord, email, web)
- Action registry (Zod schemas, authorization)
- IPC: signal-driven file protocol (SIGUSR1 wake)
- Scheduled tasks (cron)
- Auth (argon2 + JWT)
- Session continuity (diary injection on new session)
- JID normalization (telegram:, whatsapp:, discord:, email:, web:)
- Mount security (allowlist outside project dir)

## v2 — in progress

Memory layers, semantic search, product polish.

### Atlas product

- [ ] User context: per-user memory files, gateway-injected
- [ ] Semantic search: embeddings MCP sidecar (nomic-embed-text)
- [ ] Gateway fact injection (top-N relevant facts into prompt)
- [ ] Knowledge gap detection → auto-trigger researcher
- [ ] Scheduled research (cron)
- [ ] Cron git pull on symlinked repos

### Platform

- [ ] Generalized knowledge layer interface (push + pull)
- [ ] Episodes: diary → weekly/monthly aggregation
- [ ] Agent teams (multi-agent collaboration)
- [ ] Agent pipeline (continuation payload, multi-hop routing)
- [ ] Identity linking across channels
- [ ] IPC → MCP proxy (unix socket, replace file IPC)
- [ ] SSE per-sender scoping
- [ ] Message WAL (reliable delivery)

### Channels

- [ ] Reddit (feed adapter)
- [ ] Twitter (feed adapter)
- [ ] Facebook (feed adapter)
- [ ] Gmail (API + Pub/Sub)
- [ ] WebDAV (Caddy sidecar)

## v3 — planned

Go rewrite of the gateway. Agent container stays TypeScript.

- Single static binary, no node_modules
- ~10x lower memory (Go vs Node.js)
- Native concurrency (goroutines vs polling loops)
- Same SQLite schema, same .env, same IPC protocol
- Drop-in replacement for v2 gateway
- See `specs/v3/architecture.md` for full design
