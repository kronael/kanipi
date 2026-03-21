---
status: shipped
---

# Memory: Diary

Agent-written daily notes. The diary IS the task log.

## Two layers only

| Layer     | Purpose   | Content                                   |
| --------- | --------- | ----------------------------------------- |
| MEMORY.md | Knowledge | Preferences, patterns, long-term projects |
| Diary     | Work log  | Tasks, progress, decisions                |

No work.md. Diary = what happened. MEMORY.md = what matters
permanently. Nudge teaches this distinction. Memory changes
must be reported to the user verbatim. MEMORY.md stays under
200 lines — agent prunes stale entries.

## Path

`groups/<folder>/diary/YYYYMMDD.md` — mounted rw at
`/home/node/diary/`.

## File format

YAML `summary:` (5 bullet points max, critical tasks only) +
`## HH:MM` entries (250 chars max). Gateway reads summaries
for session-start injection. See diary skill for full format.

## Triggers

### 1. `/diary` skill (agent-initiated)

Agent appends to today's file. Skill also nudges: review
MEMORY.md, prune stale entries, save preferences there.

### 2. PreCompact hook (automatic)

On compaction, nudge with the skill's description text.
Agent decides whether to act. Resets turn counter.

### 3. Stop hook (every 100 turns)

```ts
if (messageCount >= 100 && !input.stop_hook_active) {
  messageCount = 0;
  return { systemMessage: nudgeText };
}
```

Same nudge text as PreCompact. Guard prevents loops.

## Gateway injection

On new session, inject diary summaries as XML:

```xml
<diary count="14">
  <entry key="20260308" age="today">summary</entry>
  ...
</diary>
```

Injects 14 entries (two weeks) until progressive summarization
ships.

## Progressive summarization (future)

Diary has its own compression hierarchy, separate from episodes:

```
diary/20260310.md  ─┐
diary/20260311.md  ─┤→ diary/week/2026-W11.md
diary/20260312.md  ─┘
                          ↓
diary/week/2026-W10.md ─┐
diary/week/2026-W11.md ─┤→ diary/month/2026-03.md
diary/week/2026-W12.md ─┘
```

Same progressive pattern as episodes but from diary entries.
Diary = agent's curated work log. Episodes = compressed session
transcripts. Both exist, both compress, different source material.

Compression uses `/compact-memories diary week` and `/compact-memories diary month`.
Week/month diary summaries live in `diary/week/` and `diary/month/`
subdirs. Each references its sources. See `specs/4/B-memory-episodic.md`.

Until this ships, 14-day injection compensates.
