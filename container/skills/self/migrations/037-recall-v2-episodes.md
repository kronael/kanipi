---
description: Recall v2 CLI, episode injection, /compact-memories skill
---

# 037 — Recall v2, Episodes, Compact Memories

## Recall v2

The `recall` CLI is now available in the container for hybrid FTS5+vector
search across knowledge stores. The `/recall` skill auto-detects it
(`which recall`) and uses the three-step protocol: expand terms → CLI
search → Explore judge. Falls back to v1 grep if CLI unavailable.

Config at `~/.recallrc`. Per-store DBs in `.local/recall/`. Lazy indexing
syncs on each call.

## Episodes

Gateway now injects episode summaries on session start:

```xml
<episodes count="3">
  <entry key="20260314" type="day">...</entry>
  <entry key="2026-W11" type="week">...</entry>
  <entry key="2026-03" type="month">...</entry>
</episodes>
```

Episodes are created by `/compact-memories` cron tasks.

## /compact-memories

New skill for progressive memory compression:

- `/compact-memories episodes day` — session transcripts → daily
- `/compact-memories episodes week` — daily → weekly
- `/compact-memories episodes month` — weekly → monthly
- `/compact-memories diary week` — diary entries → weekly
- `/compact-memories diary month` — weekly → monthly

Set up cron tasks with `context_mode: 'isolated'` per group.

## Actions

- Copy `.recallrc` from `/workspace/self/container/` if missing
- Copy `compact-memories/SKILL.md` to `~/.claude/skills/`
- Update `recall/SKILL.md` to latest version
