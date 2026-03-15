---
status: open
---

# `/recall` — Knowledge Retrieval

Generic search across knowledge stores. Read-only — never writes.
Each store registers independently; recall searches them all the
same way.

## Design

`/recall` is a search tool. It doesn't know what facts or diary
entries are — it knows how to search directories of markdown files
with YAML frontmatter summaries.

Each **store** registers:

```ts
interface KnowledgeStore {
  name: string; // 'facts', 'diary', 'episodes'
  dir: string; // relative path: 'facts/', 'diary/'
  field: string; // frontmatter field to index: 'header', 'summary'
}
```

Recall scans all registered stores identically: read the frontmatter
`field` from each `*.md` in `dir`, match against the query, return
results. A store is just a directory + a field name.

Adding a new store (e.g. `episodes/` with `summary:`) means adding
one entry to the registry. No recall code changes.

## Separation from `/facts`

`/facts` spawns researcher + verifier subagents — expensive.
`/recall` just searches what already exists.

```
question → /recall → matches? → answer from matched files
                   → no match → /facts (research + create) → answer
```

## v1: LLM semantic grep

The agent spawns an **Explore subagent** that acts as semantic grep.
It reads frontmatter from all registered stores and judges relevance
using language understanding. No embeddings, no vector DB.

### How it works

1. For each registered store, grep `*.md` files for the store's
   frontmatter `field`
2. Read each value, judge: does this relate to the query?
3. Return matches: file path + why it's relevant + store name

```
/recall "how does telegram auth work?"
  → scan facts/*.md header: fields
  → scan diary/*.md summary: fields
  → scan episodes/*.md summary: fields
  → judge each candidate
  → return: [
      {path: "facts/telegram-bot-api.md", store: "facts", why: "covers bot token auth"},
      {path: "diary/20260310.md", store: "diary", why: "mentions auth rotation"}
    ]
```

### After results

Agent deliberates in `<think>` (mandatory 3-step):

1. List matched files
2. For each: what does it say, does it answer, what gap remains
3. Verdict: use it, refresh via `/facts`, or research fresh

### Scale

Works up to ~200 files across all stores. At 500+ the header scan
gets expensive and v2 takes over.

## v2: Hybrid BM25 + vector search

Replaces LLM header scan with a search index. Same store interface —
just faster retrieval. Informed by OpenClaw (`refs/openclaw/`).

### Search

Two paths, fused:

```
query → BM25 (FTS5) → ranked results ─┐
                                        ├─ RRF fusion → top-k
query → embed → cosine (sqlite-vec) ──┘
```

**BM25** — SQLite FTS5 on frontmatter text. Exact keyword matching.
**Vector** — Ollama embeddings in sqlite-vec. Semantic similarity.
**RRF** — Reciprocal Rank Fusion. Vector 0.7, BM25 0.3.

### Embeddings

Ollama `nomic-embed-text` at 10.0.5.1:11434. Local, no API cost,
768-dim vectors, ~100ms per embed.

### Storage

One SQLite DB per group: `knowledge.db` in the group folder.

```sql
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY,
  store TEXT NOT NULL,   -- 'facts', 'diary', 'episodes'
  key TEXT NOT NULL,     -- filename without extension
  path TEXT NOT NULL,    -- relative: 'facts/telegram-bot-api.md'
  summary TEXT,          -- extracted frontmatter field value
  embedding BLOB,        -- 768-dim float vector
  mtime INTEGER,         -- file mtime at index time
  UNIQUE(store, key)
);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  store, key, summary,
  content='knowledge', content_rowid='id'
);

CREATE VIRTUAL TABLE knowledge_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[768]
);
```

### Indexing: lazy sync

Decoupled from the write path. On each `/recall` query:

1. For each registered store, scan `dir/*.md`
2. Compare path + mtime against `knowledge` table
3. New/changed → extract frontmatter, embed, upsert
4. Deleted → remove stale rows
5. Search the now-current index

First query after writes pays ~100ms/file. Subsequent queries hit
warm index. No file watchers, no gateway hooks.

### Query flow

1. Sync index
2. Embed query via Ollama
3. BM25: `SELECT ... FROM knowledge_fts WHERE knowledge_fts MATCH ?`
4. Vector: `SELECT ... FROM knowledge_vec WHERE embedding MATCH ?`
5. RRF fusion, return top-6: path, summary, score, store
6. Agent reads matched files, deliberates in `<think>`

### Optional (from OpenClaw, add if needed)

- MMR re-ranking (lambda=0.7) — diversity in results
- Temporal decay (halfLife=30 days) — boost recent
- Min score threshold (0.35) — filter noise

## Registered stores

| Store    | Dir         | Field     | Status  |
| -------- | ----------- | --------- | ------- |
| facts    | `facts/`    | `header`  | shipped |
| diary    | `diary/`    | `summary` | shipped |
| users    | `users/`    | `summary` | shipped |
| episodes | `episodes/` | `summary` | open    |

New stores register by adding a row. Recall code doesn't change.

Recall is available, not mandatory. The agent decides when to search
based on the question. Trivial messages don't trigger recall.

## Where it runs

v1: in-container. Explore subagent uses Grep/Read.
v2: in-container. SQLite DB in group folder. Move to gateway-side
only if multiple containers need the same index.

## Skill

```yaml
# container/skills/recall/SKILL.md
name: recall
description: Search existing knowledge across all stores.
always_loaded: true
```

## Open questions

- Should `MEMORY.md` be a registered store?
- Embedding model: `nomic-embed-text` (768d) vs `mxbai-embed-large` (1024d)
- v2 trigger: exact file count where v1 becomes too expensive
