# Work and task state — memory architecture

**Status**: incomplete

## Decision: two layers, clear separation

| Layer     | Purpose         | Timeframe         | Content                                |
| --------- | --------------- | ----------------- | -------------------------------------- |
| MEMORY.md | Tacit knowledge | Permanent         | Conventions, patterns, preferences     |
| Diary     | Work history    | Daily → long-term | Tasks, progress, decisions, milestones |

No work.md. No separate task state file. Two layers only.

## Diary is the work layer

Diary captures tasks and work — what started, what progressed,
what completed, what's blocked. This is the long-term view of
work. The agent writes diary entries naturally during sessions.

Progressive summarization handles scale: daily entries roll up
to weekly, then monthly. Recent entries are full detail; older
entries are distilled summaries. This gives the agent both
immediate context (today's diary) and long-term perspective
(summarized history) without separate storage.

Gateway injects recent diary entries on session start. The
agent sees what happened recently and picks up naturally.

## MEMORY.md is for knowledge, not tasks

MEMORY.md stores stable patterns — conventions, preferences,
architectural decisions, recurring solutions. Things that are
true across sessions, not tied to a specific task.

Not for: "currently working on X" or "blocked on Y." That
belongs in diary. If MEMORY.md captures active tasks, it
becomes a second diary with conflicting state.

## Why not a separate work.md

- Two agent-controlled files is the maximum before reasoning
  overhead outweighs benefit
- brainpro's WORKING.md pattern has zero production validation
- Diary already captures task creation and completion
- More files = more "where do I write this?" decisions
- work.md would compete with both MEMORY.md and diary

## Progressive summarization (future)

Daily diary entries are verbose. Over time:

- Recent (1-7 days): full entries, injected as-is
- Medium (1-4 weeks): summarized to key decisions/outcomes
- Long-term (months): distilled to major milestones

This is the episodic memory layer (`specs/3/B-memory-episodic.md`),
implemented as diary aggregation — not a new storage system.

## Open questions

- What triggers progressive summarization — scheduled task,
  session start, or manual?
- How many recent diary entries should gateway inject? (currently 2)
- Should /work skill exist as a nudge to write a diary entry,
  or is agent behavior sufficient without it?
