# Evangelist Plugin Capabilities → Kanipi Equivalents

What the eliza-plugin-evangelist provided and how to replicate in kanipi.

## Already covered by kanipi

| Capability            | Evangelist                     | Kanipi equivalent                    |
| --------------------- | ------------------------------ | ------------------------------------ |
| Codebase search       | codebaseService grep/glob      | Claude Code SDK (Grep/Glob natively) |
| Conversation logging  | JSONL daily files              | Gateway message DB + group logs/     |
| Per-agent personality | character.json + system prompt | CLAUDE.md + character.json           |
| Session management    | helpSessionManager (1h TTL)    | Group routing (trigger mode)         |
| Diary / history       | facts/.diary/YYYYMMDD.md       | diary skill (YYYYMMDD.md)            |
| File delivery         | N/A                            | send_file MCP tool                   |
| Forwarded questions   | handleForward action           | Agent handles naturally via context  |

## Partially covered — needs skill/config work

### 1. Facts loading and search

**Was:** factsService loads facts/\*.md, embeds them, semantic similarity search.
Injected into every message via knowledgeContext provider (tiered confidence).

**Now:** Facts are in `/workspace/group/facts/` — agent CAN read them.
But no automatic injection or similarity search. Agent must grep/read manually.

**To build:**

- [ ] Facts injection skill: read facts/\*.md frontmatter, inject summaries
      into session context (like diary injection but for knowledge)
- [ ] Later: embedding-based search as MCP sidecar

### 2. Codebase repo refresh

**Was:** Every 6h background task: git fetch + reset all clones.

**Now:** Repos symlinked from eliza data dir. Static snapshots.

**To build:**

- [ ] Scheduled task (kanipi task scheduler): refresh codebase repos
      `cd refs/codebase/<repo> && git fetch -q && git reset --hard origin/main`
- [ ] Or: MCP sidecar that handles git operations

## Not yet covered — needs new features

### 3. Deep research (the big one)

**Was:** 40-min background Opus research task. Clones repos, searches code,
web searches, writes findings to facts/ as YAML markdown. Sonnet verifies.
Delivered back to conversation thread via originalMessageId.

**Now:** Nothing. Agent can search mounted code but can't do background
research, can't clone new repos, can't write to facts/.

**To build:**

- [ ] Research skill: `/research <question>` triggers subagent
- [ ] Subagent gets read access to codebase + web search
- [ ] Results written to facts/ (agent has write access to group dir)
- [ ] No two-phase verification initially (simplify)
- [ ] Research delivery: inject results on next message

### 4. Stats dashboard

**Was:** HTTP dashboard at /evangelist/dashboard with stats, recent
conversations, top queries, action breakdown.

**Now:** Kanipi has web proxy but no analytics dashboard.

**To build:**

- [ ] Web app in instance web/ dir (vite)
- [ ] Read from gateway message DB for stats
- [ ] Low priority — diary serves as history

### 5. Master commands / access control

**Was:** Master users can start/stop sessions, ban users, list sessions.
Session gating: bot only responds to user with active session.

**Now:** Kanipi has trigger mode (respond when mentioned) and group routing.
No per-user session gating or ban list.

**To build:**

- [ ] Auth actions in action registry (ban/unban)
- [ ] Per-user session state (optional, low priority)
- [ ] For now: trigger mode + group registration is sufficient

### 6. Auto-indexing facts

**Was:** Facts written to facts/CLAUDE.md with counts, topics, confidence.
Automatic index rebuilt on every save.

**Now:** No auto-index. Agent reads files manually.

**To build:**

- [ ] Index skill: `/index-facts` generates facts/INDEX.md
- [ ] Run after research writes new facts
- [ ] Or: scheduled task to rebuild index

## Priority order

1. **Facts injection** — biggest impact, simplest to build (skill)
2. **Codebase refresh** — scheduled task, straightforward
3. **Deep research** — most complex, highest value
4. **Auto-indexing** — small quality-of-life
5. **Stats dashboard** — nice to have
6. **Access control** — only if multi-user demand
