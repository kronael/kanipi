---
status: open
---

# `/recall` — Knowledge Retrieval

Generic search across knowledge stores. Read-only — never writes.
All stores use `summary:` frontmatter, so recall treats them
identically. A store is just a directory name.

## Stores

```ts
const STORES = ['facts', 'diary', 'users', 'episodes'];
```

Each store is a directory of `*.md` files with `summary:` in YAML
frontmatter. Adding a store = one string. No recall code changes.

## Flow

```
question → /recall → matches? → agent reads files → answer
                   → no match → /facts (research) → answer
```

`/recall` = retrieval (cheap). `/facts` = research + creation (expensive).

## v1: LLM semantic grep (ships now)

Agent spawns an Explore subagent that greps `summary:` across all
store dirs and judges relevance. The LLM is the search engine.

### Skill

```
container/skills/recall/SKILL.md
```

```markdown
---
name: recall
description: Search knowledge stores for relevant information.
user_invocable: true
arg: <question>
---

# Recall

Search `facts/`, `diary/`, `users/`, `episodes/` for information
relevant to a question. Read-only — never writes files.

## Protocol

Spawn an Explore subagent with the query. The subagent:

1. Grep `summary:` in `*.md` across facts/, diary/, users/, episodes/
2. Read each summary value
3. Judge: does this summary relate to the query?
4. Return matches: file path, store name, why it matches

Example subagent prompt:

Search for markdown files whose `summary:` frontmatter relates to:
"<question>"

Directories: facts/, diary/, users/, episodes/

For each .md file, read the YAML `summary:` field. Return only
files where the summary clearly relates to the query. Report:
file path, directory, and why it matches.

## After results

Deliberate in `<think>` (mandatory):

1. List matched files
2. For each: what does it say? Does it answer? What gap?
3. Verdict: use it, refresh via `/facts`, or research fresh

## When to use

- Technical question → /recall (searches facts/)
- Question about a person → /recall (searches users/)
- Question about recent work → /recall (searches diary/)
- Trivial message → skip
```

### How the Explore subagent works

```
1. Grep "^summary:" across facts/*.md diary/*.md users/*.md episodes/*.md
2. For each hit, Read first 10 lines (frontmatter)
3. Extract summary value
4. Judge relevance (LLM reads natural language, decides)
5. Return [{path, store, summary, why}, ...]
```

### Scale

Up to ~300 files total: fast, one Explore call.
500+: too many summaries to read, switch to v2.

## v2: Hybrid search (when scale demands it)

Drop-in replacement for the Explore step. Same interface out
(path, store, summary, score). Only the retrieval changes.

### Architecture

```
query → BM25 (FTS5) → ranked ─┐
                                ├─ RRF → top-6
query → embed (Ollama) → vec ──┘
```

BM25 via SQLite FTS5 — keyword matching.
Vector via sqlite-vec — semantic similarity.
RRF fusion — vector 0.7, BM25 0.3.

### Embeddings

Ollama `nomic-embed-text` at 10.0.5.1:11434.
768-dim, ~100ms/embed, local, no API cost.

### DB

One `knowledge.db` per group folder:

```sql
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY,
  store TEXT NOT NULL,
  key TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  embedding BLOB,
  mtime INTEGER,
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

### Lazy indexing

On each query, before searching:

1. Scan each store dir for `*.md`
2. Compare path + mtime against DB
3. New/changed → parse `summary:`, embed, upsert
4. Deleted → prune stale rows

No file watchers. No gateway hooks. ~100ms/file for new entries.
Warm index = zero sync cost.

### Query

1. Sync index (above)
2. Embed query text
3. FTS5 match → top 20
4. Vec cosine → top 20
5. RRF: `score = Σ 1/(60 + rank)`, weighted
6. Return top-6: path, summary, score, store

### Optional (add if needed)

- MMR (lambda=0.7) — deduplicate similar results
- Temporal decay (halfLife=30d) — boost recent
- Min score (0.35) — filter noise

## What ships (v1)

1. Create `container/skills/recall/SKILL.md` (content above)
2. Update `container/CLAUDE.md` Knowledge section to use `/recall`
3. Test: few facts + diary files, run `/recall`, verify results

No gateway changes. No new TypeScript. The skill teaches the agent
the protocol, the agent uses native tools to execute it.

## v1 → v2 migration

When corpus passes ~300 files:

1. Add `knowledge.db` schema
2. Add indexer (scan, parse, embed, upsert)
3. Add query (FTS5 + vec + RRF)
4. Replace Explore call with DB query
5. Agent interface unchanged — still gets path + summary + why
