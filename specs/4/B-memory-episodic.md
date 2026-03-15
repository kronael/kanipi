---
status: open
---

# Memory: Episodes

Mechanically produced summaries of past sessions. Automatic, always on.
The agent is passive — a scheduled process aggregates diary entries
into progressively compressed episode files.

## What it is

Episodes compress diary entries upward through a time hierarchy:

```
diary/20260303.md  ─┐
diary/20260304.md  ─┤→ episodes/2026-W10.md  (week)
diary/20260305.md  ─┘
                         ↓
                   episodes/2026-03.md  (month)
```

Each level summarizes the level below. Weekly episodes aggregate daily
diary entries. Monthly episodes aggregate weekly episodes.

## Why

Without episodes, the only long-term context is the full diary archive.
After 30+ days the diary is too large to inject. Episodes provide
compressed fallbacks:

- **Cold start**: agent has no session history. Week episode gives
  enough context to resume (decisions, active projects, open blockers).
- **Long arc**: month episodes capture project-level progress that
  individual diary entries don't surface.
- **Recall input**: `/recall` scans episode summaries alongside facts
  and diary for retrieval.

## File format

Same pattern as diary — YAML frontmatter + markdown body:

```markdown
---
summary: >
  - Shipped v1.0.15 with discord channel support
  - Resolved telegram auth token rotation bug
  - Started recall spec design, researched OpenClaw search
period: 2026-W10
type: week
sources:
  - diary/20260303.md
  - diary/20260304.md
  - diary/20260305.md
  - diary/20260306.md
  - diary/20260307.md
aggregated_at: '2026-03-08T02:00:00Z'
---

## Key decisions

- Discord uses same ChannelOpts as telegram (no separate interface)
- Diary XML tag simplified from `<knowledge layer="diary">` to `<diary>`

## Active work

- /recall spec: v1 (LLM grep) + v2 (hybrid BM25+vector) designed
- Episodic memory spec: in progress

## Blockers

- None open
```

### Frontmatter fields

| Field           | Required | Description                    |
| --------------- | -------- | ------------------------------ |
| `summary:`      | yes      | 3-5 bullet points, dense       |
| `period:`       | yes      | ISO week (`2026-W10`) or month |
| `type:`         | yes      | `week` or `month`              |
| `sources:`      | yes      | list of input files aggregated |
| `aggregated_at` | yes      | timestamp of aggregation       |

### Body sections

- **Key decisions** — choices made and why
- **Active work** — what's in progress at period end
- **Blockers** — open issues, if any

The body is what the agent reads when it needs full context. The
`summary:` frontmatter is what `/recall` and gateway injection scan.

## Aggregation

### Trigger

Scheduled task (using existing `task-scheduler.ts`):

- **Weekly**: Sunday 02:00 UTC. Aggregates the past week's diary
  entries into `episodes/YYYY-WNN.md`.
- **Monthly**: 1st of month, 03:00 UTC. Aggregates the past month's
  weekly episodes into `episodes/YYYY-MM.md`.

One agent invocation per aggregation step. Sequential per group.

### Aggregation prompt

The scheduled task spawns a container with a system message that
instructs the agent to:

```
Read the following diary entries and produce a week episode summary.

Keep:
- Decisions and their reasoning
- Completed deliverables (shipped, deployed, merged)
- Active work and current state
- Open blockers and dependencies

Drop:
- Routine operations (restarts, config tweaks)
- Debugging steps that led nowhere
- Conversation meta (greetings, acknowledgements)
- Details subsumed by a later decision

Format: YAML frontmatter with summary (3-5 bullets), then body with
sections: Key decisions, Active work, Blockers.
```

Month aggregation uses the same prompt but reads week episodes instead
of diary entries, and compresses further — only project-level outcomes
survive.

### Handling gaps

Diary entries may be sparse (missed days, inactive periods). The
aggregator must handle this:

- If no diary entries exist for a week, skip — don't create an empty
  episode.
- If only 1-2 entries exist, still aggregate — a short week is still
  worth summarizing.
- If a diary entry spans multiple topics, the episode should capture
  all of them (don't filter by "importance").

## Gateway injection (push layer)

On new session, inject recent episode summaries alongside diary:

```xml
<diary count="14">
  <entry key="20260308" age="today">...</entry>
  ...
</diary>

<episodes count="2">
  <entry key="2026-W10" type="week">summary text</entry>
  <entry key="2026-W09" type="week" age="last week">summary text</entry>
</episodes>
```

**Selection**: inject current + previous week episodes. On month
boundary, also inject previous month. This gives the agent 2-3 weeks
of compressed context beyond the 14-day diary window.

**Implementation**: `formatEpisodeXml()` in a new `episode.ts`,
following the same pattern as `formatDiaryXml()` in `diary.ts`.
Called from `formatPrompt()` in `index.ts`.

## Pull layer

Episodes are also scanned by `/recall` (see `specs/3/T-recall.md`).
The `summary:` frontmatter field is what gets indexed — same as diary
summaries and fact headers.

## What gets built

1. **File format** — `episodes/*.md` with frontmatter (above)
2. **Aggregation task** — scheduled weekly/monthly, spawns container
   with aggregation prompt, writes episode file
3. **Gateway injection** — `formatEpisodeXml()`, inject on session start
4. **Recall integration** — `/recall` scans episode summaries

## Prior art

- **Muaddib**: autochronicler triggers every ~10 interactions, batches
  100 messages, sends to external LLM (1024 token cap). External LLM
  does compression; agent is passive. Our approach: agent runs the
  compression turn itself via scheduled task.
- **brainpro**: `memory/YYYY-MM-DD.md` daily notes, today + yesterday
  auto-loaded. No weekly/monthly hierarchy.

## Operational notes (rhias, Mar 2026)

The rhias instance ran a single session for 4+ days with no compaction
and no episodes. Every container restart replayed 45+ messages from raw
JSONL. Startup cost grows linearly with session length.

Episodes fix this: if the session is cold and no diary exists for today,
the week episode gives the agent enough context to resume without
replaying raw history.

Design implications:

- Weekly aggregation must be robust when diary entries are sparse
- Week episode must be sufficient for cold-start resume
- Content: decisions, active projects, open blockers

## Relationship to other specs

- `specs/1/L-memory-diary.md` — input layer (diary entries)
- `specs/3/D-knowledge-system.md` — parent pattern (episodes = push layer)
- `specs/3/T-recall.md` — episodes scanned by /recall
- `specs/3/3-code-research.md` — facts layer (episodes may feed into)

## Open questions

- Year-level aggregation: needed? Or month is enough?
- Retention: keep all episode files forever, or prune after N months?
- Should month episodes feed into facts? (auto-promote recurring themes)
- External LLM vs agent-self for aggregation (muaddib-style vs ours)
