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

## v2: CLI retrieval + Explore judge (when scale demands it)

Same Explore agent as v1 for judgment. But instead of grepping
raw files, the main agent first retrieves candidates via the
`recall` CLI tool, then feeds them to Explore.

### Three steps

```
1. Expand: main agent generates ~10 search terms from the question
2. Retrieve: `recall "term"` for each (fast, CLI, mechanical)
3. Judge: spawn Explore with all results as context + question
```

Step 1-2 are mechanical — the main agent thinks up terms and
calls the CLI. Step 3 is the LLM judgment — same Explore
subagent as v1, but with a pre-filtered, scored, richer set
to work with.

### Example

```
Main agent receives: "how does telegram auth work?"

Step 1 — expand (in <think>):
  telegram authentication, bot token, bot api login,
  telegram webhook auth, telegram session, bot api key,
  telegram oauth, telegram bot verification, ...

Step 2 — retrieve (Bash calls):
  $ recall "telegram authentication"
  0.82  facts  facts/telegram-bot-api.md
    Telegram Bot API uses long-polling or webhooks...
  0.71  diary  diary/20260310.md
    - Auth token rotation after security incident

  $ recall "bot token"
  0.79  facts  facts/telegram-bot-api.md
    Telegram Bot API uses long-polling or webhooks...
  0.45  facts  facts/discord-setup.md
    Discord bot token stored in .env, enabled by presence...

  ... (repeat for each term)

Step 3 — spawn Explore with collected results:
  "Given these search results for 'how does telegram auth work?':
   - facts/telegram-bot-api.md (score 0.82): Telegram Bot API...
   - diary/20260310.md (score 0.71): Auth token rotation...
   - facts/discord-setup.md (score 0.45): Discord bot token...
   Judge which are relevant and why."

  Explore returns:
   "facts/telegram-bot-api.md — directly covers auth flow
    diary/20260310.md — mentions rotation, tangentially relevant
    facts/discord-setup.md — different platform, not relevant"
```

The DB handles scale (500+ files → top candidates per term).
The Explore agent handles understanding (judge, explain, filter).

### Research: FTS5-only vs hybrid search

Studied OpenClaw's full hybrid implementation and sqlite-vec
ecosystem. Key findings:

**Our use case favors FTS5-only:**

- Summaries are short (1-3 sentences), keyword-rich
- The LLM expands queries (step 1) — covers synonym gaps
- The Explore agent judges semantics (step 3) — covers meaning gaps
- Corpus is small (<1000 files) — no scale pressure for vector
- FTS5 is built into SQLite — zero dependencies

**Vector search adds value for:**

- Large corpora where LLM can't expand all variations
- Long documents where keywords are diluted
- When the middle step needs semantic understanding (ours doesn't)

**sqlite-vec status:**

- npm `sqlite-vec@0.1.7-alpha.2` — alpha, 68 dependents
- Works with better-sqlite3 via `sqliteVec.load(db)`
- OpenClaw uses it with JS cosine fallback when unavailable
- Clean upgrade path: add embedding column + vec0 table later

**Decision: ship v2 with FTS5-only. Add vector as v2.1 if needed.**
The three-step flow already has semantic understanding at both ends
(LLM expansion + LLM judgment). The middle step just needs fast
keyword retrieval.

See `project/research/knowledge/recall-similarity-search.md` for
full analysis.

### Config

`.recallrc` in the group folder (TOML):

```toml
db_dir = ".local/recall"

[[store]]
name = "facts"
dir = "facts"

[[store]]
name = "diary"
dir = "diary"

[[store]]
name = "users"
dir = "users"

[[store]]
name = "episodes"
dir = "episodes"
```

Baked into agent image, managed by migrations skill. Paths
relative to the group folder. Add stores with `[[store]]` entries.

No embedding config needed for v2.0 (FTS5-only). Future v2.1
would add:

```toml
# v2.1: uncomment for hybrid search
# embed_url = "http://10.0.5.1:11434/api/embeddings"
# embed_model = "nomic-embed-text"
```

### The search tool

A CLI tool in the agent container. `container/agent-runner/recall.ts`.
Reads `.recallrc` from cwd. Uses better-sqlite3 (already in gateway,
add to container image).

```
recall                          # sync index, show 5 newest
recall "telegram auth"          # search, show top 5
recall -10 "telegram auth"      # search, show top 10
recall -3                       # sync, show 3 newest
```

No args = sync + newest. Query = search. `-N` controls result count
(default 5). Always syncs index before output.

```
0.82  facts  facts/telegram-bot-api.md
  Telegram Bot API uses long-polling or webhooks for message delivery...

0.64  diary  diary/20260310.md
  - Auth token rotation after security incident
```

### Search internals (v2.0: FTS5-only)

**BM25** — SQLite FTS5 on `key` + `summary` text. Keyword matching.

FTS5 query building (from OpenClaw pattern):

1. Tokenize query: extract alphanumeric tokens
2. Quote each token: `"telegram"`, `"auth"`
3. Join with OR: `"telegram" OR "auth"`

Score normalization: `score = 1 / (1 + abs(rank))`
BM25 returns negative rank values (lower = better match).

### Future: hybrid search (v2.1)

When corpus grows or FTS5 proves insufficient, add vector search:

1. Add `embedding BLOB` column to entries table
2. Add `entries_vec USING vec0(id INTEGER PRIMARY KEY, embedding float[768])`
3. Add `sqlite-vec` + Ollama config to `.recallrc`
4. Merge: `0.7 * vectorScore + 0.3 * textScore` (OpenClaw defaults)
5. No schema migration — just new column + table

**JS cosine fallback** (from OpenClaw): if sqlite-vec fails to load,
store embeddings as JSON, compute cosine in JS. At <1000 entries
this is ~3MB load + <10ms compute. Viable without sqlite-vec.

**nomic-embed-text** remains the right model choice: 768-dim,
~100ms/embed, top accuracy for short queries, runs on Ollama.

### DB

One DB per store in `.local/recall/` (derived cache, deletable):

```
.local/recall/facts.db
.local/recall/diary.db
.local/recall/users.db
.local/recall/episodes.db
```

`recall` creates `.local/recall/` on first run.

Each DB has the same schema:

```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,  -- filename without .md
  path TEXT NOT NULL,         -- relative: 'facts/telegram-bot-api.md'
  summary TEXT,
  mtime INTEGER
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  key, summary,
  content='entries', content_rowid='id'
);
```

Separate DBs keep stores independent — can rebuild one without
touching others. Also simpler queries (no `store` column needed).

v2.1 adds to the same DB (no migration, just CREATE IF NOT EXISTS):

```sql
ALTER TABLE entries ADD COLUMN embedding BLOB;

CREATE VIRTUAL TABLE entries_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[768]
);
```

### Lazy indexing

On each `recall` call:

1. Scan each store dir for `*.md`
2. Compare path + mtime against DB
3. New/changed → parse `summary:`, upsert (+ embed if v2.1)
4. Deleted → prune stale rows
5. Search

Warm index = zero sync cost. New entries = just FTS insert
(no network call). v2.1 adds ~100ms/file for Ollama embedding.

### Optional enhancements (add if needed)

- **Min score** (0.35) — filter noise from low-quality BM25 matches
- **Temporal decay** (halfLife=30d) — boost recent entries
- **MMR** (lambda=0.7) — deduplicate similar results (v2.1 only)

## What ships

### v1 (shipped)

- `container/skills/recall/SKILL.md`
- `container/CLAUDE.md` Knowledge section uses `/recall`

### v2.0 (when corpus > ~300 files)

1. Add `container/agent-runner/recall.ts` (FTS5-only, ~150 lines)
2. Add `better-sqlite3` to container image
3. Add `.recallrc` to container seed
4. Update skill: agent calls `recall` instead of Grep
5. Agent interface unchanged — still returns path + summary + why

### v2.1 (if FTS5 proves insufficient)

1. Add `sqlite-vec` to container image (or use JS cosine fallback)
2. Add Ollama embed config to `.recallrc`
3. Add embedding column + vec0 table to schema
4. Merge FTS + vector scores in search
5. No breaking changes — same CLI, same output format

## v1 → v2 migration

Skill adds step 1-2 (expand + CLI retrieval) before step 3
(Explore judge). Explore works the same — just gets better input.
