# ROADMAP

## Design Principles

**Claude Code is the agent runtime** — full Claude SDK with advanced
features (subagents, tool use, skills, CLAUDE.md, MEMORY.md). Not a
thin wrapper or limited API client. Every agent gets full development
capability out of the box.

**Swappable components** — each subsystem (channels, memory layers,
IPC, scheduling, container runtime) operates on a clean interface and
can be replaced independently. Products configure which components
they use, not which code path they take.

**Products are configurations, not forks** — a product is a group
with specific: CLAUDE.md (behavior), SOUL.md (persona), skills
(capabilities), mounts (data access), and scheduled tasks. The
gateway doesn't know about products — it runs groups.

**Knowledge layers are the extension point** — push layers (diary,
user context, episodes) for small corpora injected by gateway. Pull
layers (facts, codebase) for large corpora searched by agent. New
memory types plug into the same pattern.

## Current Products

### Atlas (kanipi_marinade)

Codebase Q&A + knowledge agent. Mounted repos + facts directory.
Agent greps facts and code, researches via subagents, writes findings.

**Shipped**: facts search, researcher skill, persona, diary,
voice transcription, file commands, output styles.

**Next**: see below.

### Cheerleader (spec only)

Social media curator. Drafts responses for human review.
See `specs/products/cheerleader.md`.

### Evangelist (spec only)

Outbound community engagement. Monitors external communities.
See `specs/products/evangelist.md`.

## Atlas Roadmap

### Now (v1 polish)

- [ ] User context injection (per-user memory, gateway-injected)
- [ ] Cron git pull on symlinked repos (keep codebase refs fresh)
- [ ] Per-channel output style activation

### Next (v2 quality)

- [ ] Semantic search: embeddings MCP sidecar (nomic-embed-text)
- [ ] Gateway fact injection (top-N relevant facts into prompt)
- [ ] Knowledge gap detection → auto-trigger researcher
- [ ] Scheduled research (cron)
- [ ] Episodes: diary → weekly/monthly aggregation

### Later (v3 generalization)

- [ ] Generalized knowledge layer interface
- [ ] IPC → MCP proxy (replace file IPC with unix socket)
- [ ] Identity linking across channels
- [ ] Workflow primitives (multi-step agent pipelines)

## Platform Roadmap

### Channels

- [x] Telegram, WhatsApp, Discord, Email, Web/Slink
- [ ] Reddit, Facebook, Twitter, Gmail (feed adapters)
- [ ] WebDAV (file sharing sidecar)

### Agent capabilities

- [x] Skills, diary memory, voice, file I/O, output styles
- [x] Group routing + delegation
- [ ] Agent teams (multi-agent collaboration)
- [ ] Agent pipeline (continuation, multi-hop)

### Infrastructure

- [ ] Go rewrite of gateway (v3 — see `specs/v3/architecture.md`)
- [ ] Plugin system (dynamic channel/feature loading)
- [ ] SSE per-sender scoping
- [ ] Message WAL (reliable delivery)

## Component Swappability

Each component has a clear interface. Products configure which
to use:

| Component         | Interface           | Current impl        | Swappable to         |
| ----------------- | ------------------- | ------------------- | -------------------- |
| Agent runtime     | stdin/stdout JSON   | Claude Code SDK     | any LLM container    |
| Channels          | Channel interface   | telegram/wa/discord | any messaging API    |
| Memory (push)     | md files + XML inj  | diary, user context | any file-based layer |
| Memory (pull)     | grep / MCP search   | facts/ grep         | embeddings sidecar   |
| IPC               | JSON files + signal | file IPC            | MCP unix socket      |
| Container runtime | docker CLI          | docker run          | podman, k8s          |
| Scheduling        | cron expressions    | task-scheduler.ts   | external scheduler   |
| Storage           | SQLite              | better-sqlite3      | postgres, turso      |
