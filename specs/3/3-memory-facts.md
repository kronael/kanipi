# Memory: Facts / Long-term — impl-ready (v1)

Concept-centric persistent knowledge. Agent-written, session-injected.

## What it is

Long-term memory organised by concept/entity rather than by time.
While diary asks "what happened today?", facts ask "what do we know
about Alice?" or "what is the current state of the auth system?".

Facts live in concept files alongside diary:

```
groups/<folder>/facts/
  alice.md          ← everything known about Alice
  hel1v5.md         ← server config, deployment history
  auth-system.md    ← design decisions, open questions
  ...
```

## Design decisions (v1)

| Question          | Decision                                   |
| ----------------- | ------------------------------------------ |
| Writer            | Agent writes directly (no extraction cron) |
| Contradiction     | Last-write wins                            |
| Scope             | Per-group only                             |
| Gateway injection | File list injected at session start        |
| Pruning           | None (agent decides what to keep)          |

## Relationship to MEMORY.md

| File                 | Content                                             | Updated by                      |
| -------------------- | --------------------------------------------------- | ------------------------------- |
| `MEMORY.md`          | Tacit/behavioural — style, preferences, how to work | Agent, autonomously, any time   |
| `facts/<concept>.md` | World facts — who Alice is, what hel1v5 runs        | Agent, when it learns something |

MEMORY.md is for "how" knowledge. Facts are for "what" knowledge.
Same mechanism (agent writes markdown files), different organisation
(by concept, not by behaviour).

## Push (session injection)

On new session start, gateway appends to the `_annotations` block:

```xml
<facts_index>
  alice.md
  hel1v5.md
  auth-system.md
</facts_index>
```

Agent sees which concept files exist. It reads the ones it needs via
file tools (standard Claude Code file access). Gateway never injects
content — just the index.

Injection is only on new session (`!sessionId`), same as diary.

## Pull (on demand)

Agent reads fact files directly at any time:

```
/workspace/group/facts/alice.md
/workspace/group/facts/hel1v5.md
```

No MCP needed — standard file tools.

## Writing facts

Agent creates/updates files using standard file write tools:

```
/workspace/group/facts/alice.md
```

No schema enforced. Free-form markdown. Agent decides granularity.

## Required changes

```
src/index.ts
  - listFactFiles(folder): string[]   read facts/ dir, return names
  - inject <facts_index> in !sessionId annotations block (alongside diary)
  - facts dir: groups/<folder>/facts/

container/skills/self/SKILL.md or CLAUDE.md
  - document facts/ pattern for agent
  - explain when/how to write fact files
```

`listFactFiles` is 3–4 lines: `fs.existsSync`, `fs.readdirSync`, filter `*.md`.

## Prior art (reference only)

**Martian-Engineering agent-memory**:

- `memory/entities/<entity>/items.json` — atomic facts, never deleted
- Dedup: Jaccard similarity >70% rejected
- Time decay: `e^(-λ × days_old)`, λ = ln(2)/30 (30-day half-life)
- Reference: [github.com/Martian-Engineering/agent-memory](https://github.com/Martian-Engineering/agent-memory)

**eliza-plugin-evangelist**:

- YAML frontmatter: `confidence`, `verified_at`, `findings_count`
- Vector embeddings + three-tier similarity ranking
- Two-phase Claude verification, automatic research trigger
- Reference: `/home/onvos/app/eliza-plugin-evangelist/src/services/factsService.ts`

These are v2 territory — not needed for v1's agent-written approach.

## Deferred (v2)

- Automated extraction (cron or post-session)
- Contradiction handling with supersession links
- Instance-wide shared facts (`global/facts/`)
- Per-user scoping
- Vector search / semantic recall
- Atlas MCP tools (`recall(subject)`, `search_facts(query)`)
- Retention/pruning policy
