---
status: open
---

# Memory: Progressive Compression

Session transcripts and diary entries compressed into progressive
summaries. Same pattern, two stores, shared `/compact-memories` skill.

## Hierarchy

### Episodes (from session transcripts)

```
.claude/projects/-home-node/<uuid>.jl  ─┐
.claude/projects/-home-node/<uuid>.jl  ─┤→ episodes/20260310.md  (day)
.claude/projects/-home-node/<uuid>.jl  ─┘
                                              ↓
episodes/20260310.md  ─┐
episodes/20260311.md  ─┤→ episodes/2026-W11.md  (week)
episodes/20260312.md  ─┘
                                              ↓
episodes/2026-W10.md  ─┐
episodes/2026-W11.md  ─┤→ episodes/2026-03.md  (month)
episodes/2026-W12.md  ─┘
```

### Diary (from work log entries)

```
diary/20260310.md  ─┐
diary/20260311.md  ─┤→ diary/week/2026-W11.md
diary/20260312.md  ─┘
                          ↓
diary/week/2026-W10.md ─┐
diary/week/2026-W11.md ─┤→ diary/month/2026-03.md
diary/week/2026-W12.md ─┘
```

Episodes compress the full session record. Diary compresses the
agent's curated work log. Both exist, both compress independently.

## Why

- **Cold start** — daily episode gives enough to resume
- **Long arc** — month summaries surface project-level patterns
- **Recall** — `/recall` scans `summary:` across all stores
- **Navigation** — from month → weeks → days → sources

## File format

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

`summary:` for `/recall` indexing and gateway injection.
`sources:` for traceability — navigate back to originals.
`store:` identifies `episodes` or `diary`.

## How compression happens

`/compact-memories` skill, scheduled via `task-scheduler.ts` with
`context_mode: 'isolated'`. Fresh container, no session history —
purely mechanical compression.

```
/compact-memories episodes day    → 0 2 * * *     daily
/compact-memories episodes week   → 0 3 * * 1     Monday
/compact-memories episodes month  → 0 4 1 * *     1st of month
/compact-memories diary week      → 0 3 * * 1     Monday
/compact-memories diary month     → 0 4 1 * *     1st of month
```

See `container/skills/compact-memories/SKILL.md` for protocol and
compression rules.

## Gateway injection

On session start, inject most recent of each episode type:

```xml
<episodes count="3">
  <entry key="20260314" type="day">summary</entry>
  <entry key="2026-W11" type="week">summary</entry>
  <entry key="2026-02" type="month">summary</entry>
</episodes>
```

Implementation: `formatEpisodeXml()` in `episode.ts`, same
pattern as diary injection.

Diary week/month summaries are not injected — the 14-day daily
injection already covers. Week/month diary summaries exist for
`/recall` searches over longer timeframes.

## Recall integration

Both `episodes/` and `diary/` (including subdirs) are stores in
`.recallrc`. `/recall` searches all summaries — the agent discerns
which level and store is relevant.

## What gets built

1. `/compact-memories` skill — compression rules, protocol, cron setup
2. Cron entries — five per group (3 episode + 2 diary)
3. `formatEpisodeXml()` in `episode.ts` — gateway injection
4. `episodes` + `diary` stores in `.recallrc`
