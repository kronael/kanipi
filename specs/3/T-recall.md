---
status: open
---

# `/recall` — Knowledge Retrieval

Agent-driven retrieval across facts, diary, and episodes. Read-only —
never writes files. Separate from `/facts` (research + write).

## Why separate from `/facts`

`/facts` spawns researcher + verifier subagents to create/refresh
knowledge files. That's expensive. Most questions just need retrieval:
"do we already know this?" `/recall` answers that without the overhead.

```
question → /recall → matches? → answer from matched files
                   → no match → /facts (research + create) → answer
```

## Two phases

### v1: LLM semantic grep (ships first)

The agent spawns an **Explore subagent** that acts as a semantic grep
tool — it reads YAML frontmatter from knowledge files and judges
relevance using language understanding. No embeddings, no vector DB.

#### Protocol

The `/recall` skill teaches the agent when and how to search. It is
always loaded (base skill, like `/diary`).

When the agent receives a question that might be answerable from
existing knowledge:

1. Agent spawns Explore subagent with the query
2. Explore scans target directories for frontmatter fields:
   - `facts/*.md` → `header:` field (dense paragraph)
   - `diary/*.md` → `summary:` field (5 bullet points)
   - `episodes/*.md` → `summary:` field (week/month rollup)
3. For each file, Explore reads the frontmatter and judges: does this
   header/summary relate to the query?
4. Explore returns matches with file paths + why each is relevant

```
Agent receives question
  → spawns Explore: "/recall: how does telegram auth work?"
  → Explore greps header:/summary: fields across facts/ diary/ episodes/
  → reads each candidate, judges relevance
  → returns: "2 matches:
      facts/telegram-bot-api.md (covers bot token auth flow)
      diary/20260310.md (mentions auth token rotation)"
  → Agent reads matched files
  → deliberates in <think> (mandatory 3-step)
  → answers from knowledge, or escalates to /facts
```

#### Mandatory deliberation

After receiving `/recall` results, the agent MUST deliberate in
`<think>` before answering:

1. **List** each matched file
2. **Evaluate** each: what does it say? Does it directly answer the
   question? What gap remains?
3. **Verdict**: use the fact, refresh via `/facts`, or research fresh

This is the same 3-step rule from `container/CLAUDE.md` Knowledge
section. `/recall` reinforces it in the skill description.

#### Scale limits

v1 works by having an LLM read every header. Cost is proportional to
corpus size:

- ~200 facts + 30 diary entries: fine, Explore reads all headers quickly
- 500+ files: header scan becomes expensive (tokens + latency)
- At that point, v2 takes over

### v2: Hybrid BM25 + vector search (when scale demands it)

Replaces the LLM header scan with a proper search index. Informed by
OpenClaw's architecture (see `refs/openclaw/`).

#### Two retrieval paths

**BM25 (keyword)** — SQLite FTS5 on frontmatter text. Fast exact-match
retrieval. Good for names, dates, specific terms, code identifiers.

**Vector (semantic)** — embeddings stored in sqlite-vec. Cosine
similarity finds conceptually related content even when wording differs.
"authentication flow" matches "login process" even though no words overlap.

**Fusion** — Reciprocal Rank Fusion (RRF) combines both ranked lists
into one. Default weights: vector 0.7, text 0.3.

```
query → BM25 (FTS5) → ranked results ─┐
                                        ├─ RRF fusion → top-k
query → embed → cosine (sqlite-vec) ──┘
```

#### Embedding provider

Ollama (`nomic-embed-text`) at 10.0.5.1:11434. Local inference, no API
costs, 768-dimension vectors. ~100ms per embedding.

Alternative models:

- `mxbai-embed-large` (1024-dim) — more accurate, slower
- `nomic-embed-text` (768-dim) — faster, good enough for headers

#### Storage

SQLite DB per group, lives in the group folder alongside the knowledge
dirs it indexes. Separate from the messages DB.

```
groups/<folder>/knowledge.db
```

Three tables:

```sql
-- source of truth
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY,
  layer TEXT NOT NULL,  -- 'fact', 'diary', 'episode'
  key TEXT NOT NULL,    -- 'telegram-bot-api.md', '20260310', '2026-W10'
  path TEXT NOT NULL,   -- relative: 'facts/telegram-bot-api.md'
  summary TEXT,         -- extracted header:/summary: frontmatter
  embedding BLOB,       -- 768-dim float vector (from Ollama)
  mtime INTEGER,        -- file mtime at index time
  indexed_at TEXT,
  UNIQUE(layer, key)
);

-- FTS5 for keyword search (content-sync with knowledge table)
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  layer, key, summary,
  content='knowledge',
  content_rowid='id'
);

-- sqlite-vec for vector search
CREATE VIRTUAL TABLE knowledge_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[768]
);
```

#### Indexing: lazy, self-managed

The index is decoupled from the write path. The gateway doesn't need to
know when the agent writes files. Instead, the index syncs lazily on
each `/recall` query:

1. **Scan** `facts/`, `diary/`, `episodes/` for `*.md` files
2. **Compare** each file's path + mtime against the `knowledge` table
3. **Index new/changed**: extract frontmatter, embed via Ollama, upsert
   into all three tables
4. **Prune deleted**: remove rows for files that no longer exist
5. **Search**: run the actual query against the now-current index

First query after bulk writes pays the indexing cost (~100ms per file).
Subsequent queries hit the warm index with no sync overhead (mtime
matches → skip).

```
/recall query arrives
  → scan dirs: 3 new facts, 1 changed diary entry
  → embed 4 files via Ollama (~400ms)
  → upsert into knowledge + FTS5 + vec tables
  → run BM25 + vector search
  → fuse results, return top-6
```

Alternative: standalone indexer process (cron or inotify) that keeps
the index warm. Only needed if query-time sync latency is noticeable.

#### Query flow (v2 detail)

```
1. Sync index (scan dirs, embed new files)
2. Embed the question text via Ollama
3. BM25: SELECT * FROM knowledge_fts WHERE knowledge_fts MATCH ?
         ORDER BY rank LIMIT 20
4. Vector: SELECT id, distance FROM knowledge_vec
           WHERE embedding MATCH ? ORDER BY distance LIMIT 20
5. RRF fusion:
     score(doc) = Σ 1/(k + rank_i)  for each retrieval method i
     k = 60 (standard RRF constant)
     weight: vector ranks × 0.7, BM25 ranks × 0.3
6. Return top-6 results: path, summary, score, layer
7. Agent reads matched files, deliberates in <think>
```

#### What gets indexed

Only frontmatter, not full file content:

| Layer   | Frontmatter field | Typical size      |
| ------- | ----------------- | ----------------- |
| Fact    | `header:`         | 1-3 sentences     |
| Diary   | `summary:`        | 5 bullet points   |
| Episode | `summary:`        | 3-5 bullet points |

Headers are designed for retrieval — dense, keyword-rich. Full file
content is what the agent reads AFTER matching. This keeps the index
small and embeddings focused.

#### Optional enhancements (add if needed)

From OpenClaw's implementation, available but not shipped initially:

- **MMR re-ranking** (lambda=0.7) — diversify results when top-k are
  too similar. Useful when multiple facts cover overlapping topics.
- **Temporal decay** (halfLife=30 days) — boost recent knowledge.
  Useful for diary where last week matters more than last month.
- **Min score threshold** (0.35) — filter noise. Below this score the
  match is too weak to be useful.

## Where it runs

v1: inside the agent container. Explore subagent uses native Grep/Read
tools — no gateway involvement.

v2: the index service could run either:

- **In-container**: agent manages its own index DB. Simpler, no IPC.
  The SQLite DB lives in the group folder, accessible to the container.
- **Gateway-side**: gateway manages the index, agent queries via IPC.
  Better if multiple containers need the same index.

Start with in-container. Move to gateway-side only if needed.

## Skill definition

```yaml
# container/skills/recall/SKILL.md
name: recall
description: >
  Search existing knowledge before answering. Scans facts, diary,
  and episodes for relevant information.
always_loaded: true
```

The skill's description teaches the agent the protocol: when to search,
how to interpret results, when to escalate to `/facts`.

## Relationship to other specs

- `specs/3/D-knowledge-system.md` — parent pattern (this is the pull layer)
- `specs/3/3-code-research.md` — `/facts` research agent (called when
  `/recall` finds no matches)
- `specs/1/L-memory-diary.md` — diary layer (one of the scanned layers)
- `specs/4/B-memory-episodic.md` — episodes layer (scanned when built)

## Open questions

- Should `/recall` also scan `users/*.md` files?
- Should `/recall` scan `MEMORY.md`?
- Embedding model choice: `nomic-embed-text` vs `mxbai-embed-large`
- v2 trigger: exact corpus size where v1 becomes too expensive
- In-container vs gateway-side index for v2
