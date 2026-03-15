---
status: shipped
---

# Knowledge System

The pattern underlying diary, facts, episodes, and user context.
Each is an instance of: markdown files in a directory, with
summaries selected and injected into agent context.

## Memory Layers

| Layer    | Spec                   | Status  | Storage   |
| -------- | ---------------------- | ------- | --------- |
| Messages | memory-messages.md     | shipped | DB (SQL)  |
| Session  | memory-session.md      | shipped | SDK (.jl) |
| Managed  | memory-managed.md      | shipped | Files     |
| Diary    | memory-diary.md        | shipped | Files     |
| User ctx | 3/7-user-context.md    | shipped | Files     |
| Facts    | 3/1-atlas.md           | shipped | Files     |
| Episodes | 4/B-memory-episodic.md | planned | Files     |

Diary, user context, and facts are shipped. Episodes not yet built.

## The pattern

Given a directory of markdown files:

1. **Index** — scan files, extract summaries (frontmatter or first N lines)
2. **Select** — choose which summaries to inject (by recency, sender, relevance)
3. **Inject** — insert selected summaries into agent prompt context
4. **Nudge** — at defined moments, prompt the agent to write/update files

## What fits this pattern

**Push layers** — small corpus, gateway injects automatically:

- **Diary** (`diary/*.md`) — date-keyed, 14 most recent, injected on
  session start via `formatDiaryXml()` in `index.ts` (shipped v0.7.0).
  Agent writes via `/diary` skill.
- **User context** (`users/*.md`) — sender-keyed, gateway injects
  `<user>` pointer per message, agent reads file by default (shipped).
  Agent writes via `/users` skill.
- **Episodes** (`episodes/*.md`) — event-keyed, all or recent,
  inject on session start. Not yet built.

**Pull layers** — large corpus, agent searches on demand:

- **Facts** (`facts/*.md`) — topic-keyed, too many to inject all.
  Agent scans `header:` frontmatter via grep, deliberates on relevance
  in `<think>`, reads matching files. The LLM's language understanding
  is the semantic matching — no embeddings needed.
  Researcher subagent writes; verifier reviews before merge.

Push and pull are different. Push layers need gateway code (read files,
format XML, inject). Pull layers are agent-driven — the agent searches
and reads files directly using its native tools.

Messages, sessions, and MEMORY.md have their own implementations
and aren't forced into this pattern (see layer table above).

## Injection format

Push layers format selected summaries as XML, inserted into prompt:

```xml
<diary count="2">
  <entry key="20260306" age="today">summary text</entry>
  <entry key="20260305" age="yesterday">summary text</entry>
</diary>

<user id="tg-123456" name="Alice" memory="~/users/tg-123456.md" />
```

## Nudges

Prompt the agent to write/update knowledge files:

- Hook-based: PreCompact, Stop, session start
- Message-based: first message from unknown user
- Skill-based: `/diary`, `/research`
- Scheduled: cron triggers researcher

Nudge text comes from skill config, not hardcoded in gateway.

## Push layer implementation (shipped)

Each push layer has its own formatter in a single place:

- `diary.ts` — `formatDiaryXml()`: reads `diary/*.md`, emits `<diary>` XML
- `router.ts` — `userContextXml()`: reads `users/*.md` frontmatter, emits `<user>` tag

Both are ~5 lines. The injection point is `formatPrompt()` in `index.ts`
which concatenates system messages + push layer XML + message history.

Episodes would follow the same pattern: `formatEpisodeXml()` reading
`episodes/*.md`, emitting `<episode>` XML. One function, one call site.

No generic framework needed — each layer is a small formatter with its
own tag name and selection logic. The shared part is just XML escaping.

## Pull layer implementation (shipped)

Agent-driven semantic grep. No MCP tool, no embeddings, no vector DB.

The agent IS the search engine:

1. **Inline scan** — on every technical question, the agent greps `facts/`
   `header:` fields in `<think>`, deliberates on each candidate (what does
   it say, does it answer, what gaps remain), decides use/refresh/research.
2. **Full retrieval** — `/facts` skill spawns an Explore subagent that reads
   all headers across all files, returns relevant ones.
3. **Write process** — researcher subagent creates new facts, verifier
   cross-checks before committing. See `specs/3/3-code-research.md`.

Scales to ~200 facts. At 500+ the header scan gets expensive — embeddings
would help but aren't needed yet.

## Open questions

- Performance at scale: 500+ fact files means scanning all headers
  per question. Embeddings or cached index would help. Not needed yet.
- Episode aggregation prompt: what should the agent keep at each
  compression level (day→week→month)?

## Relationship to existing specs

These specs describe specific layers built on this pattern:

- `specs/1/L-memory-diary.md` — diary layer (agent skills + gateway
  injection shipped)
- `specs/4/B-memory-episodic.md` — episodes layer (designed, not built)
- `specs/3/7-user-context.md` — user layer (shipped)
- `specs/3/3-code-research.md` — facts layer (shipped, see research + verify)

These specs describe different systems, NOT instances of this pattern:

- `specs/3/E-memory-session.md` — SDK state (container-runner.ts)
- `specs/1/N-memory-messages.md` — DB rows (router.ts SQL)
- `specs/1/M-memory-managed.md` — MEMORY.md (Claude Code native)
