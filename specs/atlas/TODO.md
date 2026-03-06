# Atlas TODO — Phased Delivery

Two phases. Phase 1: viable product (agentic search, research,
character, skills). Phase 2: semantic search, gateway injections,
generalized memory.

## Phase 1: Viability

### 1a. Fact format

Define how facts look. Start concrete for marinade, abstract later.

- [ ] Fact file format: YAML frontmatter + markdown body
  ```yaml
  ---
  topic: validator-bonds
  confidence: high
  source: liquid-staking-program/programs/marinade-finance/src/...
  verified_at: 2026-03-06
  ---
  Bond accounts store validator identity, vote account...
  ```
- [ ] Standardize existing 60+ marinade facts to this format
- [ ] Frontmatter fields: topic, confidence (high/medium/low),
      source (file:line or URL), verified_at, findings_count

### 1b. Character + skills

Agent personality and tooling for the evangelist role.

- [x] CLAUDE.md personality (high energy, evidence-based)
- [x] character.json (bio, topics, adjectives, style)
- [ ] `/facts <query>` skill — grep facts/, return matches
      with file paths. Simple keyword search. The agent already
      has grep — this skill is the prompt that tells it how to
      search facts effectively
- [ ] `/research <question>` skill — spawn subagent with:
  - read access to facts/, refs/codebase/
  - web search tools
  - write access to facts/ (new findings)
  - 5-10 min timeout (not 40 min like eliza)
  - output: new fact files with YAML frontmatter

### 1c. Researcher

Subagent workflow for growing the knowledge base.

- [ ] Research subagent prompt (what to search, how to write facts)
- [ ] Tool restrictions: Read, Glob, Grep, WebSearch, WebFetch,
      Bash (git, curl only). No Edit on existing facts
- [ ] Output: new facts/\*.md files with standardized frontmatter
- [ ] Delivery: parent agent summarizes findings to user
- [ ] Scheduled research: cron task for knowledge gap filling

### 1d. Agentic search

Agent finds facts by searching, not injection. Pull model.

- [ ] Agent CLAUDE.md instructs: search facts/ before answering
- [ ] `/facts` skill provides structured search workflow
- [ ] Agent learns which facts exist via grep, reads relevant ones
- [ ] No gateway code needed — agent searches natively

## Phase 2: Semantic + Injection

### 2a. Semantic search

Embeddings-based similarity search replaces grep.

- [ ] MCP sidecar: nomic-embed-text via Ollama
  - `search_facts(query) → [fact, similarity, path]`
  - Header-level ranking (one embedding per file)
  - Paragraph-level retrieval from top files
- [ ] Confidence tiers: high (>80%), medium (40-80%), low (<40%)
- [ ] Fallback to keyword search if embeddings unavailable

### 2b. Gateway injection

Push relevant facts into agent context automatically.

- [ ] Top-N facts injected per message (like diary injection)
- [ ] XML format: `<knowledge layer="facts" count="N">`
- [ ] Confidence attribute per fact
- [ ] Cap: 3 high, 5 medium, 5 low (per eliza pattern)

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

- [ ] `kanipi config group add` stomps existing groups on same folder
      (UNIQUE constraint on folder column, should error not replace)

## Already done

- [x] Facts files seeded (50+ marinade docs)
- [x] Codebase symlink (8 repos)
- [x] CLAUDE.md instructions + soul skill (replaces character.json)
- [x] Forward metadata extraction
- [x] Reply-to threading
- [x] Diary memory + gateway injection
- [x] Voice transcription
- [x] File commands (/put /get /ls)
- [x] Instance deployed (kanipi_marinade)
- [x] Telegram connected (@mnde_atlas_bot)
- [x] DM chat registered (tg:1112184352)
