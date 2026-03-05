# Memory: Diary — open

Agent-written daily notes. Pre-compaction flush. Automatic, always on.
The agent decides what goes in — content is subjective, freeform, chosen
by the agent. Contrast with episodes (v2) which are mechanically produced.

## What it is

The diary is the agent's persistent working memory between sessions and
across compaction boundaries. The agent writes to it; the gateway reads
a summary from it. It is the primary human-readable record of what
happened in a group over time.

```
groups/<folder>/diary/
  20260305.md     ← today's entry (appended on each flush)
  20260304.md     ← yesterday
  ...
```

## Push (auto-injected)

On session reset, the gateway reads `diary/` and injects a one-line
pointer before the message XML:

```
[Previous sessions — Deployed hel1v5. Alice working on auth. Two open bugs.
Diary: /workspace/group/diary/ (20260305.md, 20260304.md)]
```

Pointer construction (gateway-side, no API call):

1. List `groups/<folder>/diary/` — filter `*.md` excluding `YYYYMMDD.md`
   pattern is the entry files; sort descending
2. Read YAML frontmatter `summary:` field from the most recent entry
3. Take most recent 1–3 filenames
4. Inject ≤1 line before the message XML

The gateway reads only the frontmatter — never the diary body.

## Pull (on demand)

Agent reads diary files directly via file tools:

```
/workspace/group/diary/20260305.md   ← today
/workspace/group/diary/20260304.md   ← yesterday
```

Agent lists `diary/` to discover all entries and reads any it finds
relevant.

## Diary file format

Each file is freeform markdown with a YAML frontmatter summary the agent
updates on every append:

```markdown
---
summary: Deployed hel1v5. Alice working on auth. Two open bugs.
---

## 10:32

Helped Alice configure Ansible playbook for hel1v5. Key issue was the
vault password path — resolved by...

## 14:07

Discussed auth flow. Alice wants OAuth, not username/password. Left open:
which provider.
```

The agent controls the summary entirely. ≤20 words. Gateway reads only
this field for injection.

## Pre-compaction flush

When context approaches its limit, Claude Code fires `PreCompact`.
The agent runner hook injects a **silent turn**:

```
Before this session compacts: append key facts, decisions, and context
worth preserving to /workspace/group/diary/YYYYMMDD.md. Update the YAML
summary: field to reflect the current state in ≤20 words.
Reply NO_REPLY if nothing to note.
```

The turn is invisible to the user. `NO_REPLY` is suppressed.
The agent decides what matters — no mechanical transcript parsing.

This replaces the current `createPreCompactHook` in
`container/agent-runner/src/index.ts` (mechanical transcript → markdown
archive approach dropped).

**Known SDK issue**: `transcript_path` in `PreCompactHookInput` is
sometimes empty (GitHub #13668). The silent flush approach is unaffected —
it does not need the transcript path.

## Relationship to other memory layers

| Layer                | Trigger                       | Granularity                      |
| -------------------- | ----------------------------- | -------------------------------- |
| Diary (this)         | Pre-compaction flush          | Per-compaction, within a session |
| Episodes (v2)        | Scheduled task, time-based    | Per day/week/month aggregation   |
| Long-term/facts (v2) | Fed by episodes, atlas system | Concept-centric, permanent       |

Episodes aggregate diary entries upward. Long-term distills recurring
concepts from episodes. Diary is the raw input to both.

brainpro auto-loads today + yesterday's notes into every session
(not just on reset). This is an alternative push model — kept open.

## Episode notes (rhias, Mar 2026)

Observed on the rhias instance: a single session ran 4+ days with zero diary
entries. The entire memory stack was raw message history replayed from JSONL
on each container restart — no flush, no summary.

**What this means for the diary spec:**

- The pre-compaction flush is necessary but not sufficient. Rhias never
  compacted (or compaction didn't fire), so the flush never triggered.
  The diary must also flush on **session end** (idle timeout kill), not only
  on compaction. Otherwise a long, low-volume session accumulates 4 days
  of context with no diary entry until it eventually dies cold.
- The gateway injects a one-line diary pointer on session reset — but if
  no diary exists, the pointer is empty and the agent starts cold.
  The spec should note this fallback: no diary = cold start with MEMORY.md only.
- Multi-day sessions (project assistants, not chat bots) are the primary use
  case. Diary entries should carry enough project state that resuming after
  a cold start is workable, not just a session-end formality.

**Open from this episode:**

- Should diary flush also fire on container exit (not just PreCompact)?
  Rhias suggests yes — idle timeout is a common session-end path.

## Open

- Implement silent flush: replace `createPreCompactHook` in agent runner
- `diary/` path needs to be created and mounted (currently `conversations/`
  is the legacy path — migrate or rename)
- Frontmatter YAML format needs to be in agent SKILL.md / CLAUDE.md so
  agent knows the convention
- Whether to also flush on session end (not just compaction) — muaddib
  triggers chronicle every ~10 interactions regardless of context size
- Whether gateway should auto-mount last 2 diary files into every session
  (brainpro pattern) instead of pointer-only injection
