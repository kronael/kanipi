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

## How episodes are created

Scheduled tasks via `task-scheduler.ts` with `context_mode: 'isolated'`.
Fresh container, no group session history, no persona — purely
mechanical compression. The agent gets only its CLAUDE.md (which
includes the `/episode` skill) and the prompt.

Two cron entries per group, created by `group add` or migration:

```sql
-- weekly episode
INSERT INTO scheduled_tasks (group_folder, chat_jid, prompt,
  schedule_type, schedule_value, context_mode, status)
VALUES ('<folder>', '<jid>',
  'Run /episode week', 'cron', '0 2 * * 0', 'isolated', 'active');

-- monthly episode
INSERT INTO scheduled_tasks (group_folder, chat_jid, prompt,
  schedule_type, schedule_value, context_mode, status)
VALUES ('<folder>', '<jid>',
  'Run /episode month', 'cron', '0 3 1 * *', 'isolated', 'active');
```

`isolated` = no session ID passed → fresh container, no history.
The agent mounts the same group folder (reads diary/, writes
episodes/) but doesn't see the group's chat or persona.

Same mechanism works for diary too — a scheduled prompt can
trigger diary summarization if the agent didn't write one during
the session.

### What the agent does

1. Glob `diary/*.md` for the target week (or `episodes/YYYY-W*.md`
   for month)
2. Read each file
3. Compress: keep decisions, deliverables, active work, blockers.
   Drop routine ops, dead-end debugging, conversation meta.
4. Write `episodes/YYYY-WNN.md` with `summary:` frontmatter + body

### Gaps

- No diary entries for a week → agent writes nothing, no empty file
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

1. `/episode` skill — teaches agent the episode format + compression rules
2. Cron task entries — created by `group add` or migration (SQL above)
3. `formatEpisodeXml()` in `episode.ts` — gateway injection
4. `episodes` store entry in `.recallrc` — for `/recall` indexing
