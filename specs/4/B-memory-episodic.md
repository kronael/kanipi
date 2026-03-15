---
status: open
---

# Memory: Episodes

Scheduled compression of diary entries into week and month summaries.
Agent is passive — a cron task does the aggregation.

## Hierarchy

```
diary/20260303.md  ─┐
diary/20260304.md  ─┤→ episodes/2026-W10.md  (week)
diary/20260305.md  ─┘
                         ↓
                   episodes/2026-03.md  (month)
```

## Why

Diary injects 14 days. Beyond that, no compressed context exists.
Episodes fix this:

- **Cold start** — week episode gives enough to resume
- **Long arc** — month episodes surface project-level progress
- **Recall** — `/recall` scans episode `summary:` like any store

## File format

```markdown
---
summary: >
  - Shipped discord channel support
  - Resolved telegram auth token rotation
  - Started recall spec design
period: 2026-W10
type: week
sources:
  - diary/20260303.md
  - diary/20260304.md
  - diary/20260305.md
aggregated_at: '2026-03-08T02:00:00Z'
---

## Key decisions

- Discord uses same ChannelOpts as telegram

## Active work

- /recall spec v2 design

## Blockers

- None
```

Body sections: Key decisions, Active work, Blockers.
`summary:` is for `/recall` indexing and gateway injection.

## Aggregation

**Weekly** — Sunday 02:00 UTC. Reads diary entries for the week,
spawns container, agent writes `episodes/YYYY-WNN.md`.

**Monthly** — 1st of month, 03:00 UTC. Reads week episodes for
the month, agent writes `episodes/YYYY-MM.md`.

Uses existing `task-scheduler.ts`. One container per aggregation.

### Prompt

```
Read the following diary entries and produce a week episode.

Keep: decisions + reasoning, shipped deliverables, active work, blockers
Drop: routine ops, dead-end debugging, conversation meta, subsumed details

Format: YAML frontmatter (summary: 3-5 bullets, period, type, sources,
aggregated_at), then body: Key decisions, Active work, Blockers.
```

Month prompt reads week episodes, compresses further — only
project-level outcomes survive.

### Gaps

- No diary entries for a week → skip, no empty episode
- 1-2 entries → still aggregate
- Multi-topic entries → capture all topics

## Gateway injection

On session start, inject alongside diary:

```xml
<episodes count="2">
  <entry key="2026-W10" type="week">summary</entry>
  <entry key="2026-W09" type="week">summary</entry>
</episodes>
```

Current + previous week. On month boundary, also previous month.

**Implementation**: `formatEpisodeXml()` in `episode.ts`, called
from `formatPrompt()` in `index.ts`. Same pattern as diary.

## What gets built

1. `episodes/*.md` file format (above)
2. Aggregation cron tasks (weekly + monthly)
3. `formatEpisodeXml()` gateway injection
4. `/recall` store entry in `.recallrc`
