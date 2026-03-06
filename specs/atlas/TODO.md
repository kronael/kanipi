# Atlas TODO — Phased Delivery

Two phases. Phase 1: viable product (agentic search, research,
persona, skills). Phase 2: semantic search, gateway injections,
generalized memory.

## Design decisions

- **No character.json** — replaced by SOUL.md (persona) + CLAUDE.md
  (instructions). Zero code in agent-runner. SDK auto-loads group
  CLAUDE.md; SOUL.md read by agent per CLAUDE.md instruction on
  new sessions only
- **No `/facts` skill** — agent has Grep/Read natively. CLAUDE.md
  instructs: search facts/ before answering. No skill wrapper needed
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

### 1c. Researcher

`/research <question>` skill — spawns subagent to grow the knowledge base.

- [ ] Skill prompt: what to search, how to write facts
- [ ] Subagent access: facts/, refs/codebase/, web search
- [ ] Tool restrictions: Read, Glob, Grep, WebSearch, WebFetch,
      Bash (git, curl only). No Edit on existing facts
- [ ] Output: new facts/\*.md with standardized frontmatter
- [ ] Parent summarizes findings to user
- [ ] Scheduled research: cron task for knowledge gap filling

### 1d. Agentic search — done

CLAUDE.md instructs agent to grep facts/ before answering.
No skill needed — agent has Grep/Read natively.

## Phase 2: Semantic + Injection

### 2a. Semantic search

Embeddings-based similarity search replaces grep.

- [ ] MCP sidecar: nomic-embed-text via Ollama
  - `search_facts(query) → [fact, similarity, path]`
  - Header-level ranking (one embedding per file)
  - Paragraph-level retrieval from top files
- [ ] Relevance ranking by similarity score
- [ ] Fallback to keyword search if embeddings unavailable

### 2b. Gateway injection

Push relevant facts into agent context automatically.

- [ ] Top-N facts injected per message (like diary injection)
- [ ] XML format: `<knowledge layer="facts" count="N">`
- [ ] Cap: top-N most relevant facts

### 2c. User context injection

Per-user memory, gateway-injected.

- [ ] users/\*.md files (see specs/atlas/user-context.md)
- [ ] Gateway reads user file on message, injects as XML
- [ ] Agent nudge to create file on first encounter

### 2d. Verifier

Quality gate on research output.

- [ ] Second subagent pass with verify/disproval prompt
- [ ] Reject findings that fail verification
- [ ] Track verification metadata in fact frontmatter

### 2e. Knowledge gap detection

Auto-trigger research when facts are insufficient.

- [ ] After semantic search: if best match <threshold, flag gap
- [ ] Auto-spawn researcher (or queue for next scheduled run)
- [ ] Prevent duplicate research on same topic

### 2f. Per-channel output styles

Different voice per channel. SDK supports output styles natively
(`~/.claude/output-styles/*.md`). Gateway writes the style file
before spawning the container based on channel.

- [ ] Channel-aware style selection in container-runner
- [ ] Telegram style (concise, no markdown tables, 4096 char limit)
- [ ] Discord style (markdown ok, embeds, longer responses)
- [ ] Email style (formal, structured, signature)
- [ ] Web style (rich formatting, links)

### 2g. Generalized memory

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
- [x] Forward metadata extraction
- [x] Reply-to threading
- [x] Diary memory + gateway injection
- [x] Voice transcription
- [x] File commands (/put /get /ls)
- [x] Instance deployed (kanipi_marinade)
- [x] Telegram connected (@mnde_atlas_bot)
- [x] DM chat registered (tg:1112184352)
