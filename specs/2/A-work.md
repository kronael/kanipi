# Work and task state — memory architecture

**Status**: incomplete

## Decision: two layers, clear separation

| Layer     | Purpose         | Timeframe         | Content                                                     |
| --------- | --------------- | ----------------- | ----------------------------------------------------------- |
| MEMORY.md | Tacit knowledge | Permanent         | Conventions, patterns, preferences, recurring user requests |
| Diary     | Work history    | Daily → long-term | Tasks, progress, decisions, milestones                      |

No work.md. No separate task state file. Two layers only.

## Reality check: diary is unused

As of 2026-03-08, **zero diary entries exist across all 5 production
instances** (rhias, happy, krons, sloth, marinade). The diary system
is architecturally complete but practically unused because:

1. **Stop hook not implemented** — spec says nudge at 100 turns,
   code only has PreCompact hook (fires on context compaction, rare)
2. **No idle-timeout nudge** — agent gets no signal before the
   container closes after IDLE_TIMEOUT
3. **Agents don't voluntarily write** — `/diary` skill is available
   but agents never invoke it without prompting

The nudge mechanism is the critical missing piece.

## What needs to ship

### 1. Diary nudge (Stop hook)

Implement the 100-turn Stop hook from `specs/1/L-memory-diary.md`:

- Every 100 messages, nudge the agent to write a diary entry
- Guard flag (`stop_hook_active`) to prevent loops
- Reset counter on nudge or PreCompact

Also consider: nudge before idle timeout (gateway sends a
"session ending soon" signal to stdin before closing).

### 2. Inject last 14 diary entries (not 2)

Current gateway injects 2 most recent diary summaries. Until
progressive summarization exists, inject 14 (two weeks) to
give agents enough context for continuity. Each entry has a
YAML summary — these are short, total injection is small.

Change in `src/diary.ts`: `readDiaryEntries(folder, 14)`.

### 3. Diary nudge should mention MEMORY.md

When the diary skill nudges the agent, it should also say:
"if there are recurring user requests, bigger ongoing tasks,
or things the user clearly wants across sessions — put those
in MEMORY.md, not diary."

Diary is for what happened. MEMORY.md is for what matters
permanently. The nudge is the moment to teach this distinction.

### 4. Agent CLAUDE.md line

Add to agent instructions: "Recurring patterns, user preferences,
and unfinished tasks that span multiple sessions belong in
MEMORY.md. Diary is for today's events."

## Diary is the work layer

Diary captures tasks and work — what started, what progressed,
what completed, what's blocked. This is the long-term view of
work. The agent writes diary entries naturally during sessions.

Progressive summarization handles scale: daily entries roll up
to weekly, then monthly. Recent entries are full detail; older
entries are distilled summaries. This gives the agent both
immediate context (today's diary) and long-term perspective
(summarized history) without separate storage.

## MEMORY.md is for knowledge, not tasks

MEMORY.md stores stable patterns — conventions, preferences,
architectural decisions, recurring solutions. Things that are
true across sessions, not tied to a specific task.

Also for: recurring user requests that the user clearly wants
the agent to remember across sessions. If the user keeps asking
for the same thing, it belongs in MEMORY.md.

Not for: "today I did X." That's diary.

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
Until this ships, inject 14 days to compensate.

## Open questions

- What triggers progressive summarization — scheduled task,
  session start, or manual?
- Should idle-timeout nudge be gateway-side (write to stdin)
  or agent-side (hook on SIGTERM)?
- How to handle the 14→2 transition when progressive
  summarization ships?
