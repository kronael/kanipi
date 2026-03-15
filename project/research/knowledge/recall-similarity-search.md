# Recall v2 Similarity Search Research

## Question

What is the minimal yet best approach to similarity search for
recall's use case: short summaries (1-3 sentences), <1000 files,
markdown frontmatter?

## OpenClaw Reference Analysis

OpenClaw implements full hybrid search (BM25 + vector + RRF).
Key findings from reading their codebase:

### Architecture

- `memory-schema.ts`: chunks table + FTS5 virtual table + vec0 virtual table
- `manager-search.ts`: separate `searchVector()` and `searchKeyword()` functions
- `hybrid.ts`: `mergeHybridResults()` does weighted linear combination
  (not RRF despite the name — it's `vectorWeight * vecScore + textWeight * textScore`)
- Default weights: vector 0.7, text 0.3
- `mmr.ts`: optional MMR re-ranking using Jaccard similarity (not embeddings)
- `query-expansion.ts`: 600+ lines of multilingual stop word lists for FTS fallback

### sqlite-vec Integration

- `sqlite-vec.ts`: 24 lines. `import("sqlite-vec")` then `sqliteVec.load(db)`
- Uses `vec0` virtual table: `CREATE VIRTUAL TABLE ... USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[768])`
- Query: `vec_distance_cosine(v.embedding, ?) AS dist` + `ORDER BY dist ASC`
- Embeddings stored as Float32Array blobs
- **Fallback**: if sqlite-vec unavailable, loads ALL chunks into memory and does
  JS cosine similarity. Works fine at small scale.

### FTS5 Integration

- FTS5 query building: tokenize → quote each → join with " AND "
- BM25 rank to score: `1 / (1 + rank)` (rank is 0-based, lower = better)
- FTS table stores: text, id UNINDEXED, path UNINDEXED, source UNINDEXED, etc.

### Gotchas

- sqlite-vec is alpha (0.1.7-alpha.2 on npm, last published ~1yr ago)
- Extension loading requires `allowExtension: true` on DatabaseSync
- node:sqlite in Node 22 needs `--experimental-sqlite` flag
- better-sqlite3 is the stable path (kanipi gateway already uses it)

## sqlite-vec Status

- npm: `sqlite-vec@0.1.7-alpha.2` — alpha, but used by 68 packages
- Works with better-sqlite3 via `sqliteVec.load(db)`
- Works with node:sqlite via same API (Node 23.5+)
- kanipi container uses Node 22 — so better-sqlite3 is the path
- `vec_distance_cosine()` for cosine distance in SQL
- `vec0` virtual table for KNN search

## Embedding Model Assessment

### nomic-embed-text (current spec choice)

- 768-dim, ~100ms/embed via Ollama
- Top-5 accuracy: 86.2% on benchmarks
- Good for short semantic queries
- Ollama dependency: requires 10.0.5.1:11434 reachable from container

### Alternatives

- **all-MiniLM-L6-v2**: 384-dim, faster, smaller, but less accurate
- **BGE-small**: good middle ground
- For our use case (1-3 sentence summaries), nomic-embed-text is fine

### Key question: is embedding worth it?

Our summaries are short and keyword-rich:

```
summary: Telegram Bot API uses long-polling or webhooks for message delivery
summary: Auth token rotation after security incident
```

FTS5 would match "telegram" and "auth token" perfectly. Vector adds value for:

- Synonym matching ("authentication" finds "auth", "login", "credentials")
- Conceptual queries ("how do we handle bot setup" finds "token rotation")

## Approach Comparison

### Option A: FTS5 only (no vector, no Ollama)

Pros:

- Zero external dependencies
- Sub-millisecond queries
- No network calls during indexing
- Simpler code (~100 lines vs ~300)

Cons:

- No semantic matching
- "how does auth work" won't find "credentials rotation"
- Keyword expansion in the LLM (step 1) partially compensates

Verdict: **Good enough for v2.0**. The LLM generates ~10 search terms
which covers synonym gaps. FTS5 handles the rest.

### Option B: FTS5 + JS cosine (no sqlite-vec)

Pros:

- Semantic matching without sqlite-vec dependency
- Embeddings stored as JSON blobs, cosine computed in JS
- At 1000 files, loading all embeddings = ~3MB, cosine in <10ms

Cons:

- Still needs Ollama for embedding
- JSON parse of all embeddings on every search (~10ms)
- No SQL-level KNN (must load all into JS)

Verdict: **Viable for our scale**. OpenClaw does this as fallback.

### Option C: FTS5 + sqlite-vec (full hybrid, current spec)

Pros:

- Best search quality
- SQL-level KNN queries
- Standard approach (Alex Garcia's recommended pattern)

Cons:

- sqlite-vec alpha dependency
- Ollama dependency
- Most complex code path
- better-sqlite3 extension loading

Verdict: **Overkill for v2.0 launch**. Good upgrade path.

## Recommendation

**Ship FTS5-only as v2.0. Add vector as v2.1 when proven necessary.**

Rationale:

1. Our corpus is small (<1000 files) with keyword-rich summaries
2. The LLM already expands queries (step 1 generates ~10 terms)
3. The Explore agent does semantic judgment (step 3)
4. FTS5 handles the mechanical retrieval (step 2) well enough
5. Zero external dependencies = simpler container, faster startup
6. Vector search is a clean upgrade path — same DB, add embedding column + vec table

The three-step flow (expand → retrieve → judge) already has semantic
understanding at both ends (LLM expansion and LLM judgment). The middle
step just needs fast keyword retrieval, not semantic search.

## Implementation Simplification

### FTS5-only schema (much simpler)

```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  summary TEXT,
  mtime INTEGER
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  key, summary,
  content='entries', content_rowid='id'
);
```

No embedding column, no vec0 table, no Ollama config.

### FTS5 query

```sql
SELECT e.path, e.summary, bm25(entries_fts) AS rank
  FROM entries_fts f
  JOIN entries e ON e.id = f.rowid
 WHERE entries_fts MATCH ?
 ORDER BY rank
 LIMIT ?
```

### Score normalization

Use OpenClaw's approach: `score = 1 / (1 + abs(rank))`
BM25 returns negative values (lower = better match).

### Future vector upgrade path

1. Add `embedding BLOB` column to entries
2. Add `entries_vec USING vec0(...)` table
3. Add Ollama config to `.recallrc`
4. Merge FTS + vector results with weighted combination
5. No schema migration needed — just new columns + table

## References

- OpenClaw memory: `/home/onvos/app/refs/openclaw/src/memory/`
- Alex Garcia hybrid search: https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/
- sqlite-vec npm: https://www.npmjs.com/package/sqlite-vec
- sqlite-vec JS docs: https://alexgarcia.xyz/sqlite-vec/js.html
- FTS5 docs: https://www.sqlite.org/fts5.html
