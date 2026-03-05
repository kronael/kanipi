# Memory: Session — open

Claude Code session continuity across container invocations.

## Storage layer

Three things persist on the host across all spawns:

### 1. JSONL transcripts

Claude Code writes one `.jsonl` per session to
`data/sessions/<folder>/.claude/projects/-workspace-group/`.

**Compaction creates a new JSONL file.** When context fills (~95%), Claude Code
generates an LLM summary, starts a new session (new ID, new `.jsonl`), and
injects the summary as the opening context. The old file is preserved untouched.
The `newSessionId` the agent runner already returns is the post-compaction ID —
the gateway stores it and resumes from there on the next spawn.

Over time the directory accumulates one file per session:

```
abc123.jsonl   ← session 1, raw turns up to first compaction
def456.jsonl   ← session 2, starts with compaction summary + new turns
ghi789.jsonl   ← session 3, etc.
sessions-index.json  ← Claude Code-written: sessionId → summary text
```

JSONL files are not directly useful to the agent (SDK internal format) but
are the raw record of everything. Not exposed to the agent by default.

### 2. Diary entries

Agent-written notes at `groups/<folder>/diary/YYYYMMDD.md`.
Created during the **pre-compaction silent flush** (see below).
Appended if a file for today already exists. Permanent — never deleted.
Format freeform markdown, decided by the agent.

Alongside entries, the agent maintains `diary/summary.md` — a single file
updated every time a diary entry is written, containing a ≤20-word summary
of the current state. This is the only file the gateway reads for pointer
injection. The agent decides what the summary says.

```
diary/
  20260305.md     ← today's diary entry (may be appended multiple times)
  20260304.md     ← yesterday
  summary.md      ← "Deployed hel1v5. Alice working on auth. Two open bugs." (≤20w)
```

brainpro loads `memory/YYYY-MM-DD.md` for today + yesterday automatically
into every session. We could adopt the same pattern (auto-mount last 2 diary
files) rather than pointer-only injection — kept open.

### 3. CLAUDE.md / MEMORY.md

Behavioural instructions and auto-memory — always loaded, survive everything.
See `specs/v2/memory-managed.md`.

---

## Pre-compaction diary flush

Replaces the current mechanical PreCompact transcript-archive hook.

When the context window approaches its limit (~95% capacity), Claude Code
fires `PreCompact`. The agent runner hook injects a **silent turn** before
returning, prompting the agent to write a diary entry:

```
Before this session compacts: write key facts, decisions, and context
worth preserving to /workspace/group/diary/YYYYMMDD.md (append if exists).
Reply NO_REPLY if nothing to note.
```

The agent decides what matters. The turn is invisible to the user.
`NO_REPLY` responses are suppressed by the hook before returning.

This replaces `createPreCompactHook` in `container/agent-runner/src/index.ts`.
The mechanical transcript → markdown archive approach is dropped.

**Known SDK issue**: `transcript_path` in `PreCompactHookInput` is sometimes
empty (GitHub #13668). The silent flush approach is unaffected — it doesn't
need the transcript path.

---

## Session lifecycle

```
container start
  → gateway passes sessionId via stdin
  → SDK resumes transcript → agent continues
  → agent runner returns newSessionId
  → gateway stores newSessionId
  → next spawn receives it → continuous session
```

Session ID is per-group-folder. One active session per group.

Claude Code auto-compacts when context fills — this creates a **new session
and a new JSONL file**. Session ID changes. The `newSessionId` returned by the
agent runner is stored by the gateway; the next spawn resumes from it.
Diary flush fires before each compaction.

---

## Session reset

Gateway idle timeout (`IDLE_TIMEOUT`, default 30min) kills the container.
On next message the gateway starts a **new** SDK session (stored ID discarded).

The new session has no SDK context. But:

- `CLAUDE.md` + `MEMORY.md` persist → behavioural memory intact
- `diary/` entries persist → factual notes accessible
- DB messages since last agent run are piped in → recent messages visible

### Pointer injection on reset

Gateway prepends a pointer to the first prompt:

```
[Previous sessions — Deployed hel1v5. Alice working on auth. Two open bugs.
Diary: /workspace/group/diary/ (20260305.md, 20260304.md)]

<messages>...</messages>
```

Pointer construction (gateway-side, no API call):

1. Read `groups/<folder>/diary/summary.md` — the agent-maintained ≤20-word summary
2. List diary filenames, take most recent 1–3
3. Inject as ≤1 line before the message XML

The gateway reads only `summary.md` — no content parsing of diary entries.
Agent decides autonomously:

- Read a diary file if the conversation is a continuation
- Ignore if unrelated

### When to inject

| Situation                            | Action                        |
| ------------------------------------ | ----------------------------- |
| First ever start, no diary           | No injection                  |
| Idle timeout reset, diary exists     | Inject pointer                |
| SDK resume succeeded                 | No injection (context intact) |
| Explicit fresh start (user or agent) | Inject diary index only       |

---

## Session switching

### Gateway-initiated reset

Idle timeout fires → gateway discards stored session ID → next spawn is
fresh → pointer injection applies.

### Agent-initiated reset

Agent sends IPC message `type: 'reset_session'`. Gateway clears the stored
session ID for this group. Next spawn starts fresh with pointer injection.
Use case: agent decides the conversation thread is too stale to continue.

### User-initiated fresh start

User sends a message matching a reset keyword (e.g. `/new`, `/reset`).
Gateway detects this before routing to agent, clears session ID, next spawn
is fresh. Agent receives pointer injection so it knows prior context exists.

### Fresh start without compaction context

On explicit fresh start the pointer injection lists diary filenames only
(no content snippet). Agent can read what it wants via file tools — nothing
is force-loaded. This is the "skip compaction, just get refs" mode.

---

## What the agent can access

| Resource            | Path                                               | Who writes           | Access                          |
| ------------------- | -------------------------------------------------- | -------------------- | ------------------------------- |
| Diary entries       | `/workspace/group/diary/YYYYMMDD.md`               | Agent (silent flush) | Agent file tools                |
| JSONL transcripts   | `/home/node/.claude/projects/.../*.jsonl`          | Claude Code          | Not exposed to agent by default |
| sessions-index.json | same dir                                           | Claude Code          | Agent file tools (read)         |
| MEMORY.md           | `/home/node/.claude/projects/.../memory/MEMORY.md` | Agent                | Auto-loaded (200 lines)         |
| DB messages         | stdin pipe                                         | Gateway              | Injected as XML                 |

JSONL transcripts are not directly useful to the agent — they contain SDK
internal format. Diary entries and MEMORY.md are the agent-readable
persistent layer.

---

## Open

- Collapse `sessions` table into `registered_groups.session_id`
  (see `specs/v1/db-bootstrap.md`)
- Handle SDK resume failure (stale ID) — detect error, fall back to new
  session + inject pointer
- `reset_session` IPC message type — not yet defined in `specs/v1/ipc-signal.md`
- User reset keywords — detection in gateway message loop, not yet specced
- Whether to expose JSONL transcripts to agent via a `get_transcript` MCP tool
  (pull-side, on demand) — kept open
- Review brainpro and muaddib approaches when accessible
