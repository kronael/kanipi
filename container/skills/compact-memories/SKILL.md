---
name: compact-memories
description: Compress memory sources into progressive summaries.
  Works on both episodes (session transcripts) and diary entries.
  Called by scheduled tasks or manually.
user_invocable: true
arg: <store> <level>
---

# Compact Memories

Progressive compression of memory stores. Each level is built
from the level below. Two stores, same pattern.

## Stores

### Episodes (session transcripts → summaries)

| Level | Sources                             | Output                 |
| ----- | ----------------------------------- | ---------------------- |
| day   | `.claude/projects/-home-node/*.jl`  | `episodes/YYYYMMDD.md` |
| week  | `episodes/YYYYMMDD.md` (7 days)     | `episodes/2026-W11.md` |
| month | `episodes/2026-W*.md` (month weeks) | `episodes/2026-03.md`  |

### Diary (work log → summaries)

| Level | Sources                         | Output                   |
| ----- | ------------------------------- | ------------------------ |
| week  | `diary/YYYYMMDD.md` (7 days)    | `diary/week/2026-W11.md` |
| month | `diary/week/2026-W*.md` (month) | `diary/month/2026-03.md` |

Diary has no "day" level — daily entries already exist.

## Protocol

### 1. Gather sources

**Episodes day**: Glob `.claude/projects/-home-node/*.jl`, filter
by mtime for yesterday. Read transcripts — skim user messages,
tool calls, decisions.

**Episodes week/month**: Glob the lower-level episode files for
the target period.

**Diary week/month**: Glob `diary/*.md` or `diary/week/*.md` for
the target period.

No sources → stop. Never write empty files.

### 2. Compress

Keep:

- Decisions made and why
- Deliverables shipped
- Active work streams
- Blockers and resolutions
- Who was involved

Drop:

- Routine operations
- Dead-end debugging
- Conversation mechanics
- Duplicates across sources

Each level is shorter than the sum of its sources.

### 3. Write

```markdown
---
summary: >
  - Shipped discord channel support
  - Resolved telegram auth token rotation
period: '2026-W11'
type: week
store: episodes
sources:
  - episodes/20260310.md
  - episodes/20260311.md
  - episodes/20260312.md
aggregated_at: '2026-03-17T02:00:00Z'
---

## Key decisions

- Discord uses same ChannelOpts as telegram

## Active work

- /recall spec v2 design

## Blockers

- None
```

`summary:` — dense, for `/recall` and gateway injection.
`sources:` — references to the level below.
`store:` — `episodes` or `diary`.

## Usage

```
/compact-memories episodes day
/compact-memories episodes week
/compact-memories episodes month
/compact-memories diary week
/compact-memories diary month
```

## Cron setup

Scheduled tasks per group, `context_mode: 'isolated'`:

```
/compact-memories episodes day    → 0 2 * * *     (daily at 02:00)
/compact-memories episodes week   → 0 3 * * 1     (Monday at 03:00)
/compact-memories episodes month  → 0 4 1 * *     (1st of month at 04:00)
/compact-memories diary week      → 0 3 * * 1     (Monday at 03:00)
/compact-memories diary month     → 0 4 1 * *     (1st of month at 04:00)
```

`--isolated` = fresh container, no session history. Reads source
files, writes compacted summaries, nothing else.
