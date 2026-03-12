# Memory: Facts / Long-term — shipped

Concept-centric persistent knowledge. Agent-written, header-indexed retrieval.

## What it is

Long-term memory organised by concept/entity rather than by time.
While diary asks "what happened today?", facts ask "what do we know
about Alice?" or "what is the current state of the auth system?".

```
groups/<folder>/facts/
  alice.md          ← everything known about Alice
  hel1v5.md         ← server config, deployment history
  auth-system.md    ← design decisions, open questions
  ...
```

## How retrieval works

Every fact file has a dense `header:` in its YAML frontmatter — a
one-paragraph summary of the full file. The agent greps headers with
context to read all summaries in one shot:

```
Grep("header:", "facts/", -A 4)
```

`header:` is a multi-line YAML block scalar; `-A 4` captures the text
lines that follow. Matching headers → read those files in full.
No match → run `/facts` to research and create new knowledge.

A fact is fresh if `verified_at` is within 14 days. Older facts are
starting points for refresh, not discards.

No gateway injection needed — the agent uses file tools directly.
No index file needed — headers are the index.

## Schema

```yaml
---
path: <slug>
category: <top-level category>
topic: <specific topic>
verified_at: <ISO timestamp>
header: >
  <one-paragraph summary — dense enough to answer simple questions alone>
---
<full content: sources, code refs, explanations>
```

## Relationship to MEMORY.md

| File                 | Content                                             | Updated by                    |
| -------------------- | --------------------------------------------------- | ----------------------------- |
| `MEMORY.md`          | Tacit/behavioural — style, preferences, how to work | Agent, autonomously, any time |
| `facts/<concept>.md` | World facts — who Alice is, what hel1v5 runs        | Agent via `/facts` skill      |

MEMORY.md is for "how" knowledge. Facts are for "what" knowledge.

## Skill

`container/skills/facts/SKILL.md` — covers retrieval (header grep +
age check) and creation (research → write → verify). No gateway
plumbing needed.

## Deferred (v2)

- Automated extraction (cron or post-session)
- Contradiction handling with supersession links
- Instance-wide shared facts (`global/facts/`)
- Per-user scoping
- Vector search / semantic recall
- Atlas MCP tools (`recall(subject)`, `search_facts(query)`)
- Retention/pruning policy
