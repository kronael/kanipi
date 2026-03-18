# TODO

## Phase 3 — kanipi v1.x

Finish these. Small, bounded, no new architecture.

- [x] paths: hostPath() elimination (HOST\_\* exports done)
- [x] session-recovery: diary recovery entries on error/crash
- [x] diary: stop hook nudge, precompact cleanup, 14-entry injection, CLAUDE.md updates
- [x] errored chat flag: skip errored chats until new message
- [x] legacy IPC removal: drainLegacyMessages / drainLegacyTasks gone
- [x] nested IPC groups: scanGroupFolders recurse fix (atlas/support now watched)
- [x] tier auth: send_message/send_file allow tier-2 agents in same world
- [x] chat-bound-sessions: IDLE_TIMEOUT=0, send_reply action, chatJid on ActionContext (3/L)
- [x] orphan cleanup: kill nanoclaw-\* on gateway startup
- [x] stream-stall timeout: canceled
- [x] permissions: tier 0-3 gaps closed (grants.ts, send_message/send_file scoped)
- [x] think-blocks: stripThinkBlocks() in agent-runner:137 (3/M)
- [x] status-messages: extractStatusBlocks() in agent-runner:122 (3/N)
- [x] escalation impl: escalateGroup in actions/groups.ts (3/5-permissions)
- [x] jid-format: consistent platform:id URIs throughout (3/H)
- [x] dash-status: dashboard portal with containers/queues/state (src/dashboards/)
- [x] memory-episodic: compact-memories skill + episode.ts gateway injection (4/B)
- [x] sse: stream endpoint auth — /\_sloth/stream now requires session cookie
- [x] autotesting: IPC drain + voice roundtrip test gaps (3/2)
- [ ] codebase-trim: dead code removal ~900 lines (3/G)
- [x] platform-permissions: per-group platform action grants (from 4/V)
- [ ] researcher: background research subagent, writes to facts/ (from 4/H)
- [ ] support: codebase Q&A agent product config (4/3)
- [x] dashboards: memory+facts dashboard shipped (/dash/memory/ — facts, episodes, MEMORY.md)
- [ ] dashboards: long-running web services for operator tools (4/4)

## Arizuko — deferred to new instance

Requires architectural changes or new instance setup. Do not ship to marinade.

- [ ] unified home dir: groups/{folder} → /home/node, remove /workspace/group (plan: indexed-hatching-stream.md)
- [ ] detached containers: file-based IPC replaces docker stdin/stdout, enables reclaim (4/W)
- [ ] dash-memory: diary viewer and editor (4/Q) — read-only memory view shipped in Phase 3
- [ ] evangelist: community engagement agent (4/R)
- [ ] gmail channel: Gmail API + Pub/Sub (4/8)
- [ ] instance-repos: git-based config deployment (4/G)
- [ ] agent-pipeline: multi-hop routing, continuation payloads (5/2)
- [ ] ipc-mcp-proxy: unix socket replaces file IPC (5/A)
- [ ] workflows: multi-step workflow primitives (5/N)
- [ ] plugins: dynamic channel/feature loading (5/E)

## Arizuko — Atlas features

- [ ] user context: per-user memory, gateway injection (3/7)
- [ ] semantic search: embeddings MCP server
- [ ] gateway fact injection (top-N relevant)
- [ ] knowledge gap detection → auto-trigger research
- [ ] scheduled research (cron)
- [ ] v2 sandboxed support: frontend/backend split

## Dropped

- agent-routing (4/1): superseded by nested groups + routing rules (already shipped)
