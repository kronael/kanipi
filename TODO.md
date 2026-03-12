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
- [ ] autotesting: IPC drain + voice roundtrip test gaps (3/2)
- [ ] sse: auth per group on stream endpoint (3/ gap)
- [ ] permissions: close any remaining tier 0-3 gaps (3/5)
- [ ] think-blocks: <think> stripping in agent-runner, update container/CLAUDE.md (3/M)
- [ ] chat-bound-sessions: IDLE_TIMEOUT=0, send_reply action, chatJid on ActionContext (3/L)
- [ ] status-messages: <status> blocks in agent-runner, update container/CLAUDE.md (3/N)
- [ ] escalation impl: local: JID routing, escalate_group return path (3/5-permissions) — pending confirmation
- [ ] codebase-trim: dead code removal ~900 lines (3/G)
- [ ] jid-format: compact JID URIs, sender IDs (3/H)
- [x] orphan cleanup: kill nanoclaw-\* on gateway startup
- [ ] stream-stall timeout: agent-runner watchdog if no result in 5min
- [ ] platform-permissions: per-group platform action grants (from 4/V)
- [ ] dash-status: read-only health dashboard — containers, queues, errors (from 4/P)
- [ ] memory-episodic: diary → weekly/monthly aggregation via cron subagent (from 4/B)
- [ ] researcher: background research subagent, writes to facts/ (from 4/H)
- [ ] support: codebase Q&A agent product config (4/3)
- [ ] dashboards: long-running web services for operator tools (4/4)

## Arizuko — deferred to new instance

Requires architectural changes or new instance setup. Do not ship to marinade.

- [ ] unified home dir: groups/{folder} → /home/node, remove /workspace/group (plan: indexed-hatching-stream.md)
- [ ] detached containers: file-based IPC replaces docker stdin/stdout, enables reclaim (4/W)
- [ ] dash-memory: memory/diary viewer and editor (4/Q)
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
