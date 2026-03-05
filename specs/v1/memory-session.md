# Memory: Session — open

SDK session continuity across container invocations. Automatic, always on.

## What it is

A session is a Claude Code SDK conversation identified by a session ID.
The SDK stores the full transcript as a `.jsonl` file. When the gateway
spawns a container with `resume: sessionId`, the agent picks up exactly
where it left off — full context, no re-introduction needed.

## Push (auto-injected)

On session reset (idle timeout, stale ID), the gateway injects a pointer
to the most recent diary summary before the message XML. See
`specs/v1/memory-diary.md`.

On normal resume, nothing is injected — SDK context is intact.

## Pull (on demand)

`sessions-index.json` at
`/home/node/.claude/projects/-workspace-group/sessions-index.json` maps
each session ID to a Claude Code-generated summary. Readable by the agent
via file tools.

JSONL transcripts are not useful to the agent directly (SDK internal
format). Exposing them via a `get_transcript` MCP tool is open.

## Lifecycle

```
container start
  → gateway passes sessionId via stdin
  → SDK resumes transcript → agent continues in context
  → agent runner returns newSessionId
  → gateway stores newSessionId
  → next spawn receives it → continuous session
```

Session ID is per-group-folder. One active session per group (sequential,
no parallel agents). See `group-queue.ts`.

## Compaction

When context fills (~95%), Claude Code auto-compacts: generates a summary,
replaces the in-context representation, continues the session. The diary
flush fires before each compaction (see `specs/v1/memory-diary.md`).

**Unverified**: whether auto-compact creates a new session ID and new JSONL
file (GitHub #29342 suggests yes for manual `/compact`; other sources say
auto-compact keeps the same ID). Needs verification in our container setup.

## Session reset

Gateway idle timeout (`IDLE_TIMEOUT`, default 30min) kills the container.
On next message the gateway starts a new SDK session (stored ID discarded).

The new session has no SDK context. CLAUDE.md, MEMORY.md, and diary entries
persist — behavioural and factual memory survive.

Gateway injects a diary pointer before the first prompt so the agent knows
prior context exists and can choose to read it.

## Session switching

| Trigger               | Mechanism                            | Result                                                |
| --------------------- | ------------------------------------ | ----------------------------------------------------- |
| Idle timeout          | Gateway discards stored ID           | New session + diary pointer                           |
| Stale/rejected ID     | SDK resume fails, gateway falls back | New session + diary pointer                           |
| Agent request         | IPC `type:'reset_session'`           | Gateway clears ID, new session + pointer              |
| User keyword (`/new`) | Gateway detects before routing       | Gateway clears ID, new session + pointer (index only) |

On explicit user reset, the pointer lists diary filenames only — no
content injected. Agent reads what it wants.

## Open

- Collapse `sessions` table into `registered_groups.session_id`
  (see `specs/v1/db-bootstrap.md`)
- Handle SDK resume failure gracefully — detect error, fall back to new
  session + inject pointer
- `reset_session` IPC message type — not yet in `specs/v1/ipc-signal.md`
- User reset keyword detection in gateway message loop
- `get_transcript` MCP tool — expose JSONL to agent on demand
- Verify auto-compact session ID behaviour in our container setup
