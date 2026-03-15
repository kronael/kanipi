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

### Hybrid search: FTS5 + vector

Both from the start. FTS5 catches exact keywords (names, dates,
code identifiers). Vector catches semantic similarity ("auth flow"
matches "login process"). Together with LLM expansion (step 1) and
LLM judgment (step 3), the middle step covers all retrieval angles.

**sqlite-vec**: alpha (`0.1.7-alpha.2`) but functional. Works with
better-sqlite3 via `sqliteVec.load(db)`. JS cosine fallback if the
extension fails to load (store embeddings as JSON, compute in JS —
viable at <1000 entries).

**Embeddings**: Ollama `nomic-embed-text`, 768-dim, ~100ms/embed.

See `project/research/knowledge/recall-similarity-search.md` for
OpenClaw analysis.

### Config

`.recallrc` in the group folder (TOML):

```toml
db_dir = ".local/recall"
embed_url = "http://10.0.5.1:11434/api/embeddings"
embed_model = "nomic-embed-text"

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

### Search internals

**BM25** — FTS5 on `key` + `summary`. Keyword matching.
**Vector** — sqlite-vec cosine on `embedding`. Semantic similarity.
**RRF** — fuses both ranked lists. Vector 0.7, BM25 0.3.

FTS5 query: tokenize → quote → join with OR.
Score normalization: `1 / (1 + abs(rank))`.

JS cosine fallback: if sqlite-vec fails to load, store embeddings
as JSON, compute cosine in JS (~3MB + <10ms at <1000 entries).

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
  key TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  summary TEXT,
  embedding BLOB,
  mtime INTEGER
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  key, summary,
  content='entries', content_rowid='id'
);

CREATE VIRTUAL TABLE entries_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding float[768]
);
```

Separate DBs per store — rebuild one without touching others.

### Lazy indexing

On each `recall` call:

1. Scan each store dir for `*.md`
2. Compare path + mtime against DB
3. New/changed → parse `summary:`, embed via Ollama, upsert
4. Deleted → prune stale rows
5. Search

~100ms/file for new entries (Ollama embed). Warm index = zero cost.

### Optional enhancements (add if needed)

- **Min score** (0.35) — filter noise from low-quality BM25 matches
- **Temporal decay** (halfLife=30d) — boost recent entries
- **MMR** (lambda=0.7) — deduplicate similar results

## What ships

### v1 (shipped)

- `container/skills/recall/SKILL.md`
- `container/CLAUDE.md` Knowledge section uses `/recall`

### v2 (when corpus > ~300 files)

1. Add `container/agent-runner/recall.ts` (FTS5 + vector, ~200 lines)
2. Add `better-sqlite3`, `sqlite-vec` to container image
3. Add `.recallrc` to container seed
4. Update skill: agent calls `recall` CLI instead of Grep
5. Agent interface unchanged — still returns path + summary + why

## v1 → v2 migration

Skill adds step 1-2 (expand + CLI retrieval) before step 3
(Explore judge). Explore works the same — just gets better input.
