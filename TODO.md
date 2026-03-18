# TODO

## Phase 3 — kanipi v1.x

- [x] paths: hostPath() elimination (HOST\_\* exports done)
- [x] session-recovery: diary recovery entries on error/crash
- [x] diary: stop hook nudge, precompact cleanup, 14-entry injection, CLAUDE.md updates
- [x] errored chat flag: skip errored chats until new message
- [x] legacy IPC removal: drainLegacyMessages / drainLegacyTasks gone
- [x] nested IPC groups: scanGroupFolders recurse fix (atlas/support now watched)
- [x] tier auth: send_message/send_file allow tier-2 agents in same world
- [x] chat-bound-sessions: IDLE_TIMEOUT=0, send_reply action, chatJid on ActionContext (3/L)
- [x] orphan cleanup: kill nanoclaw-\* on gateway startup
- [x] permissions: tier 0-3 gaps closed (grants.ts, send_message/send_file scoped)
- [x] think-blocks: stripThinkBlocks() in agent-runner:137 (3/M)
- [x] status-messages: extractStatusBlocks() in agent-runner:122 (3/N)
- [x] escalation impl: escalateGroup in actions/groups.ts (3/5-permissions)
- [x] jid-format: consistent platform:id URIs throughout (3/H)
- [x] dash-status: dashboard portal with containers/queues/state (src/dashboards/)
- [x] memory-episodic: compact-memories skill + episode.ts gateway injection (4/B)
- [x] sse: stream endpoint auth — /\_sloth/stream requires session cookie for private groups
- [x] autotesting: IPC drain + voice roundtrip (3/2)
- [x] platform-permissions: action grants system — deriveRules, checkAction, set/get_grants IPC (4/V)
- [x] dashboards: memory+facts dashboard at /dash/memory/ (facts, episodes, MEMORY.md)
- [x] researcher: shipped as /facts skill (research + verify cycle); background cron below
- [x] support: shipped as Marinade Atlas (specs/3/3-code-research.md)
- [x] codebase-trim: dead code removal ~900 lines (3/G)
- [x] dashboards: long-running web services for operator tools (4/4)

## On-demand

- [ ] semantic search: embeddings MCP server (on demand)

## Arizuko — deferred to new instance

Requires architectural changes or new instance setup. Do not ship to marinade.

- [ ] unified home dir: groups/{folder} → /home/node, remove /workspace/group
- [x] dash-memory: diary/memory editor
- [ ] evangelist: community engagement agent (4/R)
- [x] gmail channel: dropped — generic IMAP email channel handles Gmail fine
- [ ] instance-repos: git-based config deployment (4/G)
- [ ] agent-pipeline: multi-hop routing, continuation payloads (5/2)
- [ ] ipc-mcp-proxy: unix socket replaces file IPC (5/A)
- [ ] workflows: multi-step workflow primitives (5/N)
- [ ] plugins: dynamic channel/feature loading (5/E)

## Dropped

- agent-routing (4/1): superseded by nested groups + routing rules (already shipped)
- stream-stall timeout: canceled
