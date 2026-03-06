# Knowledge System

The underlying mechanism that diary, facts, episodes, and user
context are all built on. Each is a configured instance of this system.

## What it does

Given a directory of markdown files:

1. **Index** — scan files, extract summaries (frontmatter or first N lines)
2. **Select** — choose which summaries to inject (by recency, sender, relevance)
3. **Inject** — insert selected summaries into agent prompt context
4. **Nudge** — at defined moments, prompt the agent to write/update files

## Existing implementation (diary, hardcoded)

Diary is the first knowledge layer, built directly into the gateway:

- Index: reads `diary/*.md`, parses YAML frontmatter
- Select: 2 most recent files
- Inject: on session start, as `<diary>` block with relative time
- Nudge: PreCompact hook, Stop hook at 100 turns, `/diary` skill

This works but is not reusable. Adding facts or user context
would require duplicating the same logic with different parameters.

## What the system needs to provide

### Index

Read a directory of `.md` files. For each file:

- Parse YAML frontmatter (if present)
- Extract summary: frontmatter fields, or first N lines, or both
- Cache index in memory, refresh on file change (inotify or poll)

### Select

Given a trigger context (session start, incoming message, query),
choose which summaries to inject:

- **All** — inject every summary (small corpus: diary, episodes)
- **By key match** — match a field against trigger context
  (e.g., sender ID matches user file key)
- **By recency** — N most recent by date field or mtime
- **By relevance** — search query against summaries
  (needs search tool for large corpora)

### Inject

Format selected summaries as XML block, insert into agent prompt.
Tag with layer name for agent awareness:

```xml
<knowledge layer="diary" count="2">
  <entry key="20260306" age="today">summary text</entry>
  <entry key="20260305" age="yesterday">summary text</entry>
</knowledge>

<knowledge layer="user" count="1">
  <entry key="alice">Backend dev, works on validator-bonds</entry>
</knowledge>
```

### Nudge

At defined moments, append a nudge to the agent prompt:

- Hook-based: PreCompact, Stop, session start
- Message-based: on every message, or on first message from a user
- Scheduled: cron task triggers agent with nudge prompt
- Skill-based: agent invokes `/diary`, `/research`, etc.

Nudge text comes from skill/config, not hardcoded in gateway.

## Configuration

Per-group or per-instance. Could be in group DB, CLAUDE.md,
or a dedicated config file.

```
Layer: diary
  dir: diary/
  summary: frontmatter
  select: 2 most recent
  inject_on: session_start
  nudge_on: precompact, stop
  nudge_text: (from skill description)

Layer: facts
  dir: facts/
  summary: frontmatter
  select: by relevance (needs search)
  inject_on: session_start
  nudge_on: (none — researcher writes)

Layer: users
  dir: users/
  summary: first 5 lines
  select: key matches message sender
  inject_on: every message
  nudge_on: first message from unknown user
```

## Open questions

- Config format? YAML in group dir? DB rows? CLAUDE.md section?
- Should the gateway own all injection or can the agent self-inject
  by reading files? (Agent can always read — injection is optimization)
- How does relevance selection work without embeddings?
  Grep over summaries? TF-IDF? Or just inject the index and let
  agent decide what to read?
- Should layers be declarative (config) or imperative (code per layer)?
  Diary works fine as code. Is the abstraction worth it?
- Performance: scanning 500 fact files on every session start?
  Index cache solves this but adds complexity.

## Relationship to existing specs

This system is what the following specs describe instances of:

- `specs/v1/memory-diary.md` — diary layer (shipped)
- `specs/v1/memory-session.md` — session continuity (shipped)
- `specs/v1/memory-messages.md` — message history (shipped)
- `specs/v3/memory-managed.md` — MEMORY.md (shipped, Claude Code native)
- `specs/v3/memory-facts.md` — facts layer (designed, not built)
- `specs/v3/memory-episodic.md` — episodes layer (designed, not built)
- `specs/atlas/user-context.md` — user layer (designed, not built)
- `specs/atlas/researcher.md` — writes to facts layer (designed, not built)

Those specs are not subsumed — they describe WHAT each layer does.
This spec describes the system they'd all be built on.
