---
status: partial
---

# Knowledge System

The pattern underlying diary, facts, episodes, and user context.
Each is an instance of: markdown files in a directory, with
summaries selected and injected into agent context.

## Memory Layers

| Layer    | Spec                   | Status  | Storage   |
| -------- | ---------------------- | ------- | --------- |
| Messages | memory-messages.md     | shipped | DB (SQL)  |
| Session  | memory-session.md      | shipped | SDK (.jl) |
| Managed  | memory-managed.md      | shipped | Files     |
| Diary    | memory-diary.md        | shipped | Files     |
| User ctx | 3/7-user-context.md    | shipped | Files     |
| Facts    | 3/1-atlas.md           | shipped | Files     |
| Episodes | 4/B-memory-episodic.md | planned | Files     |

Diary, user context, and facts are shipped. Episodes not yet built.

## The pattern

Given a directory of markdown files:

1. **Index** — scan files, extract summaries (frontmatter or first N lines)
2. **Select** — choose which summaries to inject (by recency, sender, relevance)
3. **Inject** — insert selected summaries into agent prompt context
4. **Nudge** — at defined moments, prompt the agent to write/update files

## What fits this pattern

**Push layers** — small corpus, gateway injects automatically:

- **Diary** (`diary/*.md`) — date-keyed, 14 most recent, injected on
  session start via `formatDiaryXml()` in `index.ts` (shipped v0.7.0).
  Agent writes via `/diary` skill.
- **User context** (`users/*.md`) — sender-keyed, gateway injects
  `<user>` pointer per message, agent reads file by default (shipped).
  Agent writes via `/users` skill.
- **Episodes** (`episodes/*.md`) — event-keyed, all or recent,
  inject on session start. Not yet built.

**Pull layers** — large corpus, agent searches on demand:

- **Facts** (`facts/*.md`) — topic-keyed, too many to inject all.
  Agent scans `header:` frontmatter via grep, deliberates on relevance
  in `<think>`, reads matching files. The LLM's language understanding
  is the semantic matching — no embeddings needed.
  Researcher subagent writes; verifier reviews before merge.

Push and pull are different. Push layers need gateway code (read files,
format XML, inject). Pull layers are agent-driven — the agent searches
and reads files directly using its native tools.

Messages, sessions, and MEMORY.md have their own implementations
and aren't forced into this pattern (see layer table above).

## Injection format

Push layers format selected summaries as XML, inserted into prompt:

```xml
<diary count="2">
  <entry key="20260306" age="today">summary text</entry>
  <entry key="20260305" age="yesterday">summary text</entry>
</diary>

<user id="tg-123456" name="Alice" memory="~/users/tg-123456.md" />
```

## Nudges

Prompt the agent to write/update knowledge files:

- Hook-based: PreCompact, Stop, session start
- Message-based: first message from unknown user
- Skill-based: `/diary`, `/research`
- Scheduled: cron triggers researcher

Nudge text comes from skill config, not hardcoded in gateway.

## Push layer implementation

**Shipped**: diary (`formatDiaryXml()` in `diary.ts`) and user context
(`userContextXml()` in `router.ts`). Both ~5 lines each. Injection
point is `formatPrompt()` in `index.ts`.

**TODO**: Unified XML schemas. Each layer's format should be a typed
structure (DTO/schema) with a shared formatter:

```ts
// src/schemas/knowledge.ts — shared types
interface KnowledgeEntry {
  key: string;        // "20260306", "tg-123456", "2026-W09"
  attrs: Record<string, string>;  // age, confidence, etc.
  summary: string;
}

interface KnowledgeLayer {
  tag: string;        // "diary", "user", "episode"
  entries: KnowledgeEntry[];
}

function formatLayerXml(layer: KnowledgeLayer): string { ... }
```

Each layer defines its own schema and selection logic, calls the
shared formatter. Not a framework — just organized types and one
XML helper. The formatters stay in their own files:

- `diary.ts` → `formatDiaryXml()` uses `KnowledgeLayer` with tag `"diary"`
- `router.ts` → `userContextXml()` uses its own format (pointer, not entries)
- `episode.ts` (future) → `formatEpisodeXml()` with tag `"episode"`

Episodes would follow the same pattern once built.

## Pull layer: `/recall`

Agent-driven knowledge retrieval across facts, diary, and episodes.
Two phases: v1 ships LLM-as-search-engine (Explore subagent greps
headers); v2 adds hybrid BM25+vector search for scale.

**Shipped** (as CLAUDE.md behavior): agent greps `facts/` `header:` fields,
deliberates in `<think>`, reads matches.

**TODO**: `/recall` skill — teaches the agent the semantic search protocol.
Always-present base skill (like `/diary`, `/users`).

### v1: LLM semantic grep (now)

The agent spawns an **Explore subagent** with a query and target layers.
The Explore agent knows the protocol:

1. Scan `header:` (facts) or `summary:` (diary) YAML frontmatter
2. Read each candidate header, judge relevance to the query
3. Return matches with file paths + why each is relevant

The calling agent receives results, deliberates in `<think>` (mandatory
3-step: what does it say, does it answer, what gaps remain), then either
answers from the matched files or escalates to `/facts` for research.

```
Agent receives question
  → spawns Explore with "/recall: <question>"
  → Explore scans facts/ headers + diary/ summaries
  → Explore returns: "3 matches: facts/X.md (covers Y), diary/20260310.md (mentions Z)"
  → Agent reads matched files, deliberates in <think>
  → answers from knowledge, or runs /facts if gaps remain
```

Scales to ~200 facts + 30 diary entries. At 500+ the header scan gets
expensive and v2 takes over.

### v2: Hybrid search (when scale demands it)

Informed by OpenClaw's search architecture. Two retrieval paths fused:

**BM25 (keyword)** — SQLite FTS5 on fact headers + diary summaries.
Fast exact-match retrieval, good for names, dates, specific terms.

**Vector (semantic)** — embeddings on the same text, stored in
sqlite-vec. Cosine similarity finds conceptually related content
even when wording differs.

**Fusion** — Reciprocal Rank Fusion (RRF) combines both result sets.
Default weights: vector 0.7, text 0.3. Single ranked list out.

```
query → BM25 (FTS5) → ranked results ─┐
                                        ├─ RRF fusion → top-k results
query → embed → cosine (sqlite-vec) ──┘
```

**Embedding provider**: Ollama (`nomic-embed-text`) at 10.0.5.1:11434.
Local, no API costs, 768-dim vectors.

**Storage**: SQLite DB per group (separate from messages DB, lives in
group folder). Three tables:

```sql
-- source table
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY,
  layer TEXT,     -- 'fact', 'diary', 'episode'
  key TEXT,       -- 'api-auth.md', '20260310', '2026-W10'
  path TEXT,      -- relative path to file
  summary TEXT,   -- header/summary frontmatter
  embedding BLOB, -- 768-dim float vector
  mtime INTEGER,  -- file mtime at index time
  indexed_at TEXT
);

-- FTS5 for keyword search
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  layer, key, summary, content='knowledge'
);

-- sqlite-vec for vector search
CREATE VIRTUAL TABLE knowledge_vec USING vec0(
  embedding float[768]
);
```

**Indexing**: Lazy, self-managed. The index service is decoupled from
the gateway — it doesn't need to know when files are written. On each
`/recall` query:

1. Scan `facts/`, `diary/`, `episodes/` for `*.md` files
2. Compare each file's path+mtime against the `knowledge` table
3. For new/changed files: extract frontmatter, embed via Ollama, upsert
4. For deleted files: remove stale rows
5. Then run the search

This means the index rebuilds incrementally on demand. First query
after bulk writes pays a small cost (~100ms per file to embed), but
subsequent queries hit the warm index. No file watchers, no gateway
hooks, no coupling to the write path.

Alternative: a standalone indexer process (cron or inotify watcher)
that keeps the index warm. Only needed if query-time indexing latency
becomes noticeable.

**Query flow**:

1. Sync index (steps 1-4 above)
2. Embed the question via Ollama
3. Run BM25 (FTS5) + vector (sqlite-vec) in parallel
4. Fuse with RRF, return top-6 with scores
5. Agent deliberates in `<think>`, reads matched files

**Optional enhancements** (from OpenClaw, add if needed):

- MMR re-ranking (lambda=0.7) for diversity in results
- Temporal decay (halfLife=30 days) to prefer recent knowledge
- Min score threshold (0.35) to filter noise

### Layers scanned

| Layer    | Key field       | Example                              |
| -------- | --------------- | ------------------------------------ |
| Facts    | `header:` YAML  | dense paragraph, optimized for match |
| Diary    | `summary:` YAML | 5 bullet points per day              |
| Episodes | `summary:` YAML | week/month rollup (when built)       |

### Separation from `/facts`

- **`/recall`** — retrieval only. Scan, match, return. No writing.
- **`/facts`** — research only. Create/refresh facts via research +
  verification subagents. Called when `/recall` finds no matches.

Currently both are bundled in `/facts`. Separating them means the agent
can recall without the overhead of spawning researcher + verifier.

## What's left to build

1. **Unified schemas** — typed DTOs for each layer's XML format,
   shared `formatLayerXml()` helper
2. **`/recall` v1 skill** — Explore subagent semantic grep across
   facts + diary headers. Always-present base skill.
3. **Separate recall from `/facts`** — `/facts` becomes research-only
4. **`/recall` v2** — hybrid BM25+vector search. SQLite + sqlite-vec,
   Ollama embeddings, RRF fusion. Ships when corpus exceeds ~200 facts.
5. **Episodes** — scheduled aggregation from diary, formatter, injection
6. **Episode aggregation prompt** — what to keep at each compression
   level (day→week→month)

## Open questions

- Should `/recall` also scan `users/` and `MEMORY.md`?
- Episode format: same `<entry>` structure as diary, or its own?
- v2 trigger: at what corpus size does LLM grep become too slow/expensive?
  Estimated ~200 facts is fine, 500+ needs v2.
- Embedding model: `nomic-embed-text` (768-dim) vs `mxbai-embed-large`
  (1024-dim) — nomic is faster, mxbai may be more accurate
- Should v2 index full file content or just headers/summaries?
  Headers-only keeps the index small and fast.

## Relationship to existing specs

These specs describe specific layers built on this pattern:

- `specs/1/L-memory-diary.md` — diary layer (agent skills + gateway
  injection shipped)
- `specs/4/B-memory-episodic.md` — episodes layer (designed, not built)
- `specs/3/7-user-context.md` — user layer (shipped)
- `specs/3/3-code-research.md` — facts layer (shipped, see research + verify)

These specs describe different systems, NOT instances of this pattern:

- `specs/3/E-memory-session.md` — SDK state (container-runner.ts)
- `specs/1/N-memory-messages.md` — DB rows (router.ts SQL)
- `specs/1/M-memory-managed.md` — MEMORY.md (Claude Code native)
