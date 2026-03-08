# Memory: Diary

**Status**: partial — injection shipped, nudge not implemented, zero real entries

Agent-written daily notes. Primary record of work and tasks
over time. The diary IS the task log — no separate tracking.

See `specs/1/K-knowledge-system.md` for memory layer overview.

## Architecture: two layers only

| Layer     | Purpose         | Timeframe         | Content                                                     |
| --------- | --------------- | ----------------- | ----------------------------------------------------------- |
| MEMORY.md | Tacit knowledge | Permanent         | Conventions, patterns, preferences, recurring user requests |
| Diary     | Work history    | Daily → long-term | Tasks, progress, decisions, milestones                      |

No work.md. No separate task state file. Diary captures what
happened, MEMORY.md captures what matters permanently. The
diary nudge teaches this distinction.

## Reality check (2026-03-08)

Zero diary entries exist across all 5 production instances.
The nudge mechanism (Stop hook at 100 turns) was spec'd but
never implemented. Agents have the `/diary` skill but never
invoke it voluntarily.

## Path

```
groups/<folder>/diary/YYYYMMDD.md
```

Mounted rw at `/workspace/group/diary/` inside the container.

## File format

```markdown
---
summary: |
  Working on kanipi gateway. Alice is the main user.
  - auth: OAuth flow design, provider TBD
  - deploy: hel1v5 done
  - ipc: two file-sending bugs open
---

## 10:32

Helped Alice configure Ansible for hel1v5. Vault password
path was wrong — fixed. deploy: done.

## 14:07

Auth flow discussion. Alice wants OAuth not passwords.
auth: provider TBD. New task — ipc: file sending broken,
ENOENT on sendDocument.
```

- `summary:` — YAML block scalar. First line: project and who
  you work with. Up to 5 bullet points of critical tasks only.
  Gateway reads only this field for session-start injection.
- `## HH:MM` entries — 250 chars max each. Entries introduce
  and update tasks naturally. The diary IS the task log.
- Agent may rewrite/compress old entries to save space
- If nothing noteworthy, skip

## Triggers

### 1. `/diary` skill (agent-initiated)

Agent can run `/diary` anytime. The skill instructs the agent
to append to `/workspace/group/diary/YYYYMMDD.md`.

### 2. PreCompact hook (automatic)

On compaction, nudge the agent with the skill's description:

```
If anything worth noting happened since your last diary
entry, record it in /workspace/group/diary/YYYYMMDD.md.
If there are recurring user requests or patterns worth
remembering across sessions, put those in MEMORY.md instead.
```

Agent decides whether to act. Not a command — a nudge.
Resets the turn counter. **STATUS: partially implemented** —
PreCompact hook exists but still dumps old transcript format
instead of clean nudge.

### 3. Stop hook turn nudge (every 100 turns)

Agent-runner tracks `messageCount`. On Stop hook:

```ts
if (messageCount >= 100 && !input.stop_hook_active) {
  messageCount = 0;
  return { systemMessage: nudgeText };
}
```

- `nudgeText` same as PreCompact (single source of truth)
- `stop_hook_active` guard prevents infinite loops
- Counter resets on nudge; PreCompact also resets it
- **STATUS: not implemented**

## Gateway: session-start injection

On session reset, gateway reads diary YAML frontmatter and
injects as XML knowledge block:

```xml
<knowledge layer="diary" count="2">
  <entry key="20260308" age="today">summary text</entry>
  <entry key="20260307" age="yesterday">summary text</entry>
</knowledge>
```

Currently injects 2 entries. Change to 14 (two weeks) until
progressive summarization ships — agents need more context
for continuity without long-term memory.

No diary = no injection (cold start with MEMORY.md only).

## What needs to ship

### 1. Stop hook nudge

Implement the 100-turn counter in agent-runner. This is the
critical missing piece — without it agents never write diary.

### 2. Fix PreCompact hook

Replace transcript dump with clean nudge text. Remove dead
`parseTranscript`, `formatTranscriptMarkdown` code.

### 3. Inject 14 entries (not 2)

Change `readDiaryEntries(folder, 14)` in index.ts. Until
progressive summarization exists, two weeks of summaries
gives enough context. Each summary is short — total cost low.

### 4. Nudge teaches MEMORY.md distinction

Nudge text should say: "recurring user requests and patterns
that matter across sessions belong in MEMORY.md, not diary."

### 5. Agent CLAUDE.md updates

Add to `container/CLAUDE.md`:

- "Write diary entries during sessions for important events"
- "Recurring patterns and user preferences belong in MEMORY.md"
- Currently CLAUDE.md only says to _read_ diary, never to write

## Progressive summarization (future)

Daily diary entries are verbose. Over time:

- Recent (1-7 days): full entries, injected as-is
- Medium (1-4 weeks): summarized to key decisions/outcomes
- Long-term (months): distilled to major milestones

This is the episodic memory layer (`specs/3/B-memory-episodic.md`),
implemented as diary aggregation. Until it ships, inject 14 days.

## Implementation

| Component  | File                                  | Change                              | Status          |
| ---------- | ------------------------------------- | ----------------------------------- | --------------- |
| Mount      | `src/container-runner.ts`             | Diary dir mount                     | shipped         |
| Injection  | `src/diary.ts`, `src/index.ts`        | Read frontmatter, inject XML        | shipped (2→14)  |
| PreCompact | `container/agent-runner/src/index.ts` | Replace transcript dump with nudge  | needs fix       |
| Stop hook  | `container/agent-runner/src/index.ts` | Turn counter nudge at 100           | not implemented |
| Skill      | `container/skills/diary/SKILL.md`     | Add MEMORY.md distinction to nudge  | needs update    |
| CLAUDE.md  | `container/CLAUDE.md`                 | Add diary writing + MEMORY.md lines | needs update    |
