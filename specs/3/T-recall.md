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

## v2: Agent with search tool (when scale demands it)

Same Explore agent as v1, just with a faster retrieval tool.
v1's agent greps raw files. v2's agent calls `search_knowledge`
backed by FTS5 + sqlite-vec. The agent is the same — it thinks
about what to search, calls the tool, judges results, iterates.

The DB gives the agent a better-informed starting set — scored,
ranked, with similarity context. The agent can then iterate:
narrow down, broaden out, or dig deeper based on what it sees.
Each search is fast, so the agent can afford more iterations.

### How the agent works

The recall agent gets the user's question plus context from the
main agent. Then it works in steps:

```
Step 1: Think about what to search for
  "The user is asking about telegram auth. I should search for:
   - telegram authentication
   - bot token
   - telegram login"

Step 2: Call search_knowledge for each term
  → search_knowledge("telegram authentication") → 5 results
  → search_knowledge("bot token") → 3 results

Step 3: Read the summaries, judge relevance
  "facts/telegram-bot-api.md covers the auth flow directly.
   diary/20260310.md mentions token rotation but tangentially."

Step 4: Maybe search again with refined terms
  "The bot-api fact mentions webhooks but I should also check
   for webhook auth specifically..."
  → search_knowledge("webhook authentication") → 2 more

Step 5: Return final matches with reasoning
```

The agent iterates naturally — no hardcoded stages. It expands
queries, judges results, and refines search terms as needed. This
is what v1 does with Grep, but the search tool handles scale.

### The search tool

A small CLI script the agent calls via Bash. Takes a query string,
returns JSON results from the index.

```
container/agent-runner/recall.ts
```

```
recall "telegram auth"    → JSON results
recall --sync             → rebuild index only
recall --stats            → index stats
```

Internally: BM25 (FTS5) + vector (sqlite-vec) + RRF fusion.
The agent doesn't need to know how it works — it just calls
the tool and gets results back.

```
0.82  facts  facts/telegram-bot-api.md
  Telegram Bot API uses long-polling or webhooks for message delivery...

0.64  diary  diary/20260310.md
  - Auth token rotation after security incident
```

### Search internals

**BM25** — SQLite FTS5 on `summary` text. Keyword matching.
**Vector** — Ollama embeddings in sqlite-vec. Semantic similarity.
**RRF** — fuses both ranked lists. Vector 0.7, BM25 0.3.

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

On each `recall` call:

1. Scan each store dir for `*.md`
2. Compare path + mtime against DB
3. New/changed → parse `summary:`, embed via Ollama, upsert
4. Deleted → prune stale rows
5. Search

~100ms/file for new entries. Warm index = zero sync cost.

### Optional enhancements (add if needed)

- **MMR** (lambda=0.7) — deduplicate similar results after RRF
- **Temporal decay** (halfLife=30d) — boost recent entries
- **Min score** (0.35) — filter noise

### Why agent > script pipeline

A script pipeline (expand → retrieve → re-rank) is rigid — fixed
stages, fixed number of iterations. The agent is flexible:

- It decides how many search terms to try
- It reads results and refines its search if the first pass
  misses something
- It can read the actual files if summaries are ambiguous
- It explains WHY each match is relevant (not just a score)

Same capability as v1's Explore subagent, but with a fast search
tool instead of raw grep. The LLM still makes all the decisions.

## What ships

### v1 (shipped)

- `container/skills/recall/SKILL.md`
- `container/CLAUDE.md` Knowledge section uses `/recall`

### v2 (when corpus > ~300 files)

1. Add `container/agent-runner/recall.ts`
2. Add `better-sqlite3`, `sqlite-vec` to container image
3. Update skill: agent calls `recall` instead of Grep
4. Agent interface unchanged — still returns path + summary + why

## v1 → v2 migration

The skill tells the agent to use `recall` instead of
grepping raw files. The agent's behavior is the same — think about
what to search, search, judge, iterate. Just faster retrieval.
