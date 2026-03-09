# Memory: Diary

**Status**: shipped

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
`/workspace/group/diary/`.

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

**Status**: done — clean diary nudge only.

### 3. Stop hook (every 100 turns)

```ts
if (messageCount >= 100 && !input.stop_hook_active) {
  messageCount = 0;
  return { systemMessage: nudgeText };
}
```

Same nudge text as PreCompact. Guard prevents loops.
**Status**: done.

## Gateway injection

On new session, inject diary summaries as XML:

```xml
<knowledge layer="diary" count="14">
  <entry key="20260308" age="today">summary</entry>
  ...
</knowledge>
```

Injects 14 entries (two weeks) until progressive summarization
ships.

## What ships

| Item                                             | Status |
| ------------------------------------------------ | ------ |
| Mount + dir creation                             | done   |
| Gateway injection (summaries → XML, 14 entries)  | done   |
| Diary skill (format, rules, MEMORY.md nudge)     | done   |
| Agent CLAUDE.md (diary + memory sections)        | done   |
| PreCompact hook (clean nudge)                    | done   |
| Stop hook (100-turn counter)                     | done   |
| Recovery entries (gateway writes on error/crash) | done   |

## Progressive summarization (future)

Daily → weekly → monthly rollup. See `specs/3/B-memory-episodic.md`.
Until it ships, 14-day injection compensates.
