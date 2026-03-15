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

Combines vector+BM25 retrieval with LLM-aided query expansion
and re-ranking. The DB narrows 500+ files to ~20 candidates,
then the LLM judges and expands — best of both worlds.

### Architecture

```
query ──→ LLM: expand search terms ──→ expanded queries
                                           │
              ┌────────────────────────────┘
              ▼
     BM25 (FTS5) → ranked ─┐
                             ├─ RRF → top-20 candidates
     embed → vec cosine ────┘
              │
              ▼
     LLM: judge relevance, re-rank → top-6 results
```

Three stages:

1. **Query expansion** — LLM generates 2-3 alternative phrasings
   and related terms. "telegram auth" → ["telegram bot token",
   "bot api authentication", "telegram login flow"]. Each becomes
   a separate BM25+vec query.

2. **Retrieval** — BM25 (FTS5) + vector (sqlite-vec) on each
   expanded query. RRF fuses all result sets into one ranked list.
   Returns top-20 candidates (generous, to feed the LLM judge).

3. **Re-ranking** — LLM reads the top-20 summaries and the
   original question. Judges each: relevant or not, and why.
   Returns the final top-6 with explanations.

This is strictly better than pure vector search (catches
synonyms the embedder misses) and strictly better than pure
LLM grep (scales past 300 files). The LLM still makes the
final relevance decision — it just sees 20 candidates instead
of 500.

### Where code lives

v2 is a standalone module the agent can run. Two options:

**Option A: In-container script** (preferred, simpler)

```
container/agent-runner/recall.ts    # indexer + search
```

The agent runs it directly: `npx tsx ~/recall.ts search "query"`.
No gateway changes. The script reads the group folder, manages
`knowledge.db`, and returns JSON results to stdout.

```
recall.ts index              # sync index (scan dirs, embed, upsert)
recall.ts search "query"     # index + search, return JSON
recall.ts stats              # show index stats (file counts, staleness)
```

**Option B: MCP tool** (if agent needs structured interface)

Gateway exposes `recall_search(query)` MCP tool. Agent calls it
like any other tool. Gateway manages the index. Only needed if
multiple containers share one index.

Start with Option A. The skill teaches the agent to shell out to
the script instead of spawning an Explore subagent.

### Embeddings

Ollama `nomic-embed-text` at 10.0.5.1:11434.
768-dim, ~100ms/embed, local, no API cost.

```ts
async function embed(text: string): Promise<Float32Array> {
  const r = await fetch('http://10.0.5.1:11434/api/embeddings', {
    method: 'POST',
    body: JSON.stringify({ model: 'nomic-embed-text', prompt: text }),
  });
  const { embedding } = await r.json();
  return new Float32Array(embedding);
}
```

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

Dependencies: `better-sqlite3`, `sqlite-vec` (npm packages,
already available in agent container base image or add to
container build).

### Indexer

Runs before every search. Incremental — only touches changed files.

```ts
const STORES = [
  { name: 'facts', dir: 'facts' },
  { name: 'diary', dir: 'diary' },
  { name: 'users', dir: 'users' },
  { name: 'episodes', dir: 'episodes' },
];

async function syncIndex(db: Database, root: string) {
  const indexed = new Set<string>();

  for (const store of STORES) {
    const dir = join(root, store.dir);
    if (!existsSync(dir)) continue;

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const path = join(store.dir, file);
      const abs = join(root, path);
      const mtime = statSync(abs).mtimeMs;
      indexed.add(path);

      // skip if unchanged
      const row = db
        .prepare('SELECT mtime FROM knowledge WHERE path = ?')
        .get(path);
      if (row && row.mtime === mtime) continue;

      // extract summary from frontmatter
      const content = readFileSync(abs, 'utf8');
      const summary = parseSummary(content);
      if (!summary) continue;

      // embed
      const embedding = await embed(summary);

      // upsert
      db.prepare(
        `
        INSERT INTO knowledge (store, key, path, summary, embedding, mtime)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(store, key) DO UPDATE SET
          summary=excluded.summary, embedding=excluded.embedding,
          mtime=excluded.mtime
      `,
      ).run(
        store.name,
        file.replace('.md', ''),
        path,
        summary,
        Buffer.from(embedding.buffer),
        mtime,
      );
    }
  }

  // prune deleted files
  const all = db.prepare('SELECT path FROM knowledge').all();
  for (const row of all) {
    if (!indexed.has(row.path)) {
      db.prepare('DELETE FROM knowledge WHERE path = ?').run(row.path);
    }
  }
}
```

### Stage 1: Query expansion (LLM)

Before hitting the DB, the LLM generates expanded search terms.
This catches synonyms and related concepts the embedder might miss.

```ts
async function expandQuery(query: string): Promise<string[]> {
  // LLM generates 2-3 alternative phrasings
  // "telegram auth" → ["telegram bot token", "bot api authentication"]
  const prompt = `Given this search query, generate 2-3 alternative
phrasings that would match relevant documents. Return one per line,
nothing else.\n\nQuery: ${query}`;
  const expanded = await llm(prompt); // Ollama or Claude
  return [query, ...expanded.split('\n').filter(Boolean)];
}
```

Cheap — one small LLM call (~50 tokens out). Can use Ollama
(llama3, mistral) or Claude haiku for this.

### Stage 2: Retrieval (DB)

Run BM25 + vector for each expanded query, fuse all results:

```ts
interface Result {
  path: string;
  store: string;
  summary: string;
  score: number;
}

async function retrieve(db: Database, queries: string[]): Promise<Result[]> {
  const scores = new Map<string, { result: Result; score: number }>();
  const K = 60;

  for (const q of queries) {
    const qvec = await embed(q);

    // BM25
    const bm25 = db
      .prepare(
        `
      SELECT k.path, k.store, k.summary, rank
      FROM knowledge_fts fts
      JOIN knowledge k ON k.id = fts.rowid
      WHERE knowledge_fts MATCH ?
      ORDER BY rank LIMIT 20
    `,
      )
      .all(q);

    // Vector
    const vec = db
      .prepare(
        `
      SELECT k.path, k.store, k.summary, v.distance
      FROM knowledge_vec v
      JOIN knowledge k ON k.id = v.id
      WHERE v.embedding MATCH ?
      ORDER BY v.distance LIMIT 20
    `,
      )
      .all(Buffer.from(qvec.buffer));

    // RRF per query
    for (let i = 0; i < bm25.length; i++) {
      const r = bm25[i];
      const s = scores.get(r.path) || { result: r, score: 0 };
      s.score += 0.3 / (K + i + 1);
      scores.set(r.path, s);
    }
    for (let i = 0; i < vec.length; i++) {
      const r = vec[i];
      const s = scores.get(r.path) || { result: r, score: 0 };
      s.score += 0.7 / (K + i + 1);
      scores.set(r.path, s);
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20) // generous — feed to LLM judge
    .map((s) => ({ ...s.result, score: s.score }));
}
```

### Stage 3: Re-ranking (LLM)

The LLM reads the top-20 summaries and judges relevance to the
original question. This is the v1 Explore judgment, but on 20
pre-filtered candidates instead of 500 raw files.

```ts
async function rerank(query: string, candidates: Result[]): Promise<Result[]> {
  const summaryList = candidates
    .map((c, i) => `${i}. [${c.store}] ${c.path}: ${c.summary}`)
    .join('\n');

  const prompt = `Question: ${query}

These are candidate knowledge files. For each, judge: does the
summary answer or relate to the question? Return the indices of
relevant results, most relevant first. One per line, nothing else.

${summaryList}`;

  const response = await llm(prompt);
  const indices = response
    .split('\n')
    .map((l) => parseInt(l.trim()))
    .filter((n) => !isNaN(n) && n < candidates.length);

  return indices.slice(0, 6).map((i) => candidates[i]);
}
```

### Full pipeline

```ts
async function search(db: Database, query: string): Promise<Result[]> {
  await syncIndex(db, root);
  const queries = await expandQuery(query);
  const candidates = await retrieve(db, queries);
  return rerank(query, candidates);
}
```

### Output format

```json
{
  "results": [
    {
      "path": "facts/telegram-bot-api.md",
      "store": "facts",
      "summary": "Telegram Bot API uses...",
      "score": 0.0142
    },
    {
      "path": "diary/20260310.md",
      "store": "diary",
      "summary": "- Auth token rotation...",
      "score": 0.0098
    }
  ],
  "indexed": 3,
  "total": 247
}
```

### Optional enhancements (add if needed)

- **MMR** (lambda=0.7) — deduplicate similar results after RRF
- **Temporal decay** (halfLife=30d) — boost recent entries
- **Min score** (0.35) — filter noise before LLM re-ranking

## What ships

### v1 (now)

1. Create `container/skills/recall/SKILL.md`
2. Update `container/CLAUDE.md` Knowledge section
3. Test: few facts + diary files, verify results

No gateway changes. No new TypeScript.

### v2 (when corpus > ~300 files)

1. Add `container/agent-runner/recall.ts` (indexer + search)
2. Add `sqlite-vec` to container image deps
3. Update skill to call script instead of Explore subagent
4. Agent interface unchanged — still gets path + summary + score

## v1 → v2 migration

The skill content changes from "spawn Explore subagent" to
"run `recall.ts search`". The agent's deliberation protocol
(3-step in `<think>`) stays the same. The output format is
the same. Only the retrieval backend changes.
