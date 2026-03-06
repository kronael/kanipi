# Knowledge System

The pattern underlying diary, facts, episodes, and user context.
Each is an instance of: markdown files in a directory, with
summaries selected and injected into agent context.

**Status**: Pattern identified, no implementation yet. Diary has
agent-side skills (write/read) but no gateway-side injection.
This spec is forward-looking design, not generalization of
working code.

## The pattern

Given a directory of markdown files:

1. **Index** — scan files, extract summaries (frontmatter or first N lines)
2. **Select** — choose which summaries to inject (by recency, sender, relevance)
3. **Inject** — insert selected summaries into agent prompt context
4. **Nudge** — at defined moments, prompt the agent to write/update files

## What fits this pattern

**Push layers** — small corpus, gateway injects automatically:

- **Diary** (`diary/*.md`) — date-keyed, 2 most recent, inject on
  session start. Agent writes via `/diary` skill. NOT YET INJECTED
  BY GATEWAY — agent reads files manually today.
- **User context** (`users/*.md`) — sender-keyed, match by message
  sender, inject on every message. Agent writes on first encounter.
- **Episodes** (`episodes/*.md`) — event-keyed, all or recent,
  inject on session start. Agent writes on notable events.

**Pull layers** — large corpus, agent searches on demand:

- **Facts** (`facts/*.md`) — topic-keyed, too many to inject all.
  Agent uses search tool (RAG/grep) to find relevant files.
  Researcher subagent writes; verifier reviews before merge.

Push and pull are fundamentally different. Push layers need gateway
code (read files, format XML, inject into prompt). Pull layers need
a search tool (MCP server or skill) and a write process (researcher).
Don't try to unify them into one mechanism.

## What does NOT fit this pattern

- **Messages** — DB rows queried by SQL in router.ts. Not files.
- **Sessions** — SDK state managed by container-runner.ts. Not files.
- **MEMORY.md** — Claude Code native feature, not gateway-managed.

These have their own working implementations and shouldn't be
forced into the knowledge system abstraction.

## Injection format

Push layers format selected summaries as XML, inserted into prompt:

```xml
<knowledge layer="diary" count="2">
  <entry key="20260306" age="today">summary text</entry>
  <entry key="20260305" age="yesterday">summary text</entry>
</knowledge>

<knowledge layer="user" count="1">
  <entry key="alice">Backend dev, works on validator-bonds</entry>
</knowledge>
```

## Nudges

Prompt the agent to write/update knowledge files:

- Hook-based: PreCompact, Stop, session start
- Message-based: first message from unknown user
- Skill-based: `/diary`, `/research`
- Scheduled: cron triggers researcher

Nudge text comes from skill config, not hardcoded in gateway.

## Push layer implementation (first to build)

The gateway needs a minimal knowledge injector:

1. Read configured directories of `.md` files
2. Parse YAML frontmatter or first N lines as summary
3. Select entries (by recency, by key match)
4. Format as XML block, prepend to agent prompt

This is ~100 lines of code. Start with diary injection (already
has agent-side skills), then user context.

## Pull layer implementation

Facts are too numerous to inject. The agent needs:

1. A search tool — MCP server with `search_knowledge(query)`
   backed by embeddings (Ollama at 10.0.5.1:11434) or grep
2. A write process — researcher subagent triggered by knowledge
   gaps or explicit request
3. A quality gate — verifier reviews researcher output before
   facts are committed

See `specs/atlas/researcher.md` for the write process.

## Open questions

- Should push layers be declarative (config) or imperative (code
  per layer)? Start with code — abstract only if a third layer
  looks identical to the first two.
- Performance: scanning 500 fact files for search index?
  Cache index in memory, refresh on file change.
- Researcher quality: auto-commit facts or require review?
  Unreviewed auto-injection is a misinformation pipeline.
- Can the agent self-inject by reading files instead of gateway
  injection? (Agent can always read — injection is optimization
  for consistent context.)

## Relationship to existing specs

These specs describe specific layers built on this pattern:

- `specs/v1/memory-diary.md` — diary layer (agent skills shipped,
  gateway injection not built)
- `specs/v3/memory-facts.md` — facts layer (designed, not built)
- `specs/v3/memory-episodic.md` — episodes layer (designed, not built)
- `specs/atlas/user-context.md` — user layer (designed, not built)
- `specs/atlas/researcher.md` — writes to facts layer (designed, not built)

These specs describe different systems, NOT instances of this pattern:

- `specs/v1/memory-session.md` — SDK state (container-runner.ts)
- `specs/v1/memory-messages.md` — DB rows (router.ts SQL)
- `specs/v3/memory-managed.md` — MEMORY.md (Claude Code native)
