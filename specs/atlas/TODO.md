# Atlas TODO — Phased Delivery

Two phases. Phase 1: viable product (agentic search, research,
persona, skills). Phase 2: semantic search, gateway injections,
generalized memory.

## Design decisions

- **No character.json** — replaced by SOUL.md (persona) + CLAUDE.md
  (instructions). Zero code in agent-runner. SDK auto-loads group
  CLAUDE.md; SOUL.md read by agent per CLAUDE.md instruction on
  new sessions only
- **`/facts` skill** — research + verify pipeline via subagents.
  CLAUDE.md auto-triggers when facts/ search has no matches
- **Facts are binary** — verified or deleted. No confidence tiers on
  facts themselves. `confidence` and `findings_count` are eliza
  artifacts to strip. Search relevance (similarity) is separate
- **Atlas-specific vs general** — facts/ search instruction is in
  shared container CLAUDE.md for now. Split to group CLAUDE.md later
  if it becomes noise for non-atlas instances

## Phase 1: Viability

### 1a. Fact format — done

60+ marinade facts have YAML frontmatter from eliza-atlas migration.
Useful fields: path, category, topic, verified_at, header (summary
for search). Strip: `confidence`, `findings_count` (eliza artifacts).

### 1b. Persona — done

- [x] SOUL.md persona (replaces character.json)
- [x] Agentic search (CLAUDE.md instructs: grep facts/)

### 1c. Researcher — done

`/facts` skill: research subagent → write facts → verifier
subagent (batches of 5) → delete bad facts → answer user.
CLAUDE.md auto-triggers when facts/ has no matches.
Scheduled research (cron) deferred to phase 2.

### 1d. Agentic search — done

CLAUDE.md instructs agent to grep facts/ before answering.
No skill needed — agent has Grep/Read natively.

## Phase 2: Polish

### 2a. Keep codebase refs fresh

- [ ] Cron git pull on symlinked repos in /workspace/extra/

### 2b. Per-channel output styles

SDK output styles: markdown files in `~/.claude/output-styles/`,
activated via `.claude/settings.local.json`. Gateway writes the
style file + settings before spawning the container.

- [ ] Gateway: write channel style file + activate in settings
- [ ] Telegram style (concise, no markdown tables, 4096 char limit)
- [ ] Discord style (markdown ok, embeds, longer responses)
- [ ] Email style (formal, structured, signature)
- [ ] Web style (rich formatting, links)

### 2c. Verifier — done (in research flow)

Verification is the second subagent in the /facts skill.

## Phase 3: Semantic + Injection

Requires embeddings sidecar infrastructure.

### 3a. Semantic search

Embeddings-based similarity search replaces grep.

- [ ] MCP sidecar: nomic-embed-text via Ollama
  - `search_facts(query) → [fact, similarity, path]`
  - Header-level ranking (one embedding per file)
  - Paragraph-level retrieval from top files
- [ ] Relevance ranking by similarity score
- [ ] Fallback to keyword search if embeddings unavailable

### 3b. Gateway injection

Push relevant facts into agent context automatically.

- [ ] Top-N facts injected per message (like diary injection)
- [ ] XML format: `<knowledge layer="facts" count="N">`
- [ ] Cap: top-N most relevant facts

### 3c. User context injection

Per-user memory, gateway-injected.

- [ ] users/\*.md files (see specs/atlas/user-context.md)
- [ ] Gateway reads user file on message, injects as XML
- [ ] Agent nudge to create file on first encounter

### 3d. Knowledge gap detection

Auto-trigger research when facts are insufficient.

- [ ] After semantic search: if best match <threshold, flag gap
- [ ] Auto-spawn researcher (or queue for next scheduled run)
- [ ] Prevent duplicate research on same topic

### 3e. Generalized memory

Abstract the pattern across diary, facts, episodes, user context.

- [ ] Common knowledge layer interface (see knowledge-system.md)
- [ ] Push layers: small corpus, gateway-injected (diary, user, episodes)
- [ ] Pull layers: large corpus, agent-searched (facts)
- [ ] Shared frontmatter parsing, XML injection format
- [ ] Episodes: scheduled aggregation of diary → weekly/monthly summaries

## Bugs

- [x] `kanipi config group add` stomps existing groups on same folder
      — fixed: check folder ownership before insert, error if taken

## Already done

- [x] Facts files seeded (50+ marinade docs)
- [x] Codebase symlink (8 repos)
- [x] CLAUDE.md instructions + SOUL.md persona (replaces character.json)
- [x] Agentic search (CLAUDE.md → grep facts/)
- [x] /facts skill (research + verify subagent pipeline)
- [x] Group add bug fixed (folder ownership check)
- [x] Phase 1 shipped + redeployed
- [x] Forward metadata extraction
- [x] Reply-to threading
- [x] Diary memory + gateway injection
- [x] Voice transcription
- [x] File commands (/put /get /ls)
- [x] Instance deployed (kanipi_marinade)
- [x] Telegram connected (@mnde_atlas_bot)
- [x] DM chat registered (tg:1112184352)
