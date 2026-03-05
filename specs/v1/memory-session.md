# Memory: Session — open

SDK session continuity across container invocations. Automatic, always on.

## What it is

A session is a Claude Code SDK conversation identified by a session ID.
The SDK stores the full transcript as a `.jsonl` file. When the gateway
spawns a container with `resume: sessionId`, the agent picks up exactly
where it left off — full context, no re-introduction needed.

Session ID is per-group-folder. One active session per group (sequential,
no parallel agents). See `group-queue.ts`.

## Lifecycle

```
container start
  → gateway passes sessionId via stdin
  → SDK resumes transcript → agent continues in context
  → agent runner returns newSessionId
  → gateway stores newSessionId
  → next spawn receives it → continuous session
```

## Compaction

When context fills (~95%), Claude Code auto-compacts: generates a summary,
replaces the in-context representation, continues the session.

**Unverified**: whether auto-compact creates a new session ID and new JSONL
file (GitHub #29342 suggests yes for manual `/compact`; other sources say
auto-compact keeps the same ID). Needs verification in our container setup.

The diary flush (pre-compaction) is handled separately in
`specs/v1/memory-diary.md`.

## Session reset

Gateway idle timeout (`IDLE_TIMEOUT`, default 30min) kills the container.
On next message the gateway starts a new SDK session (stored ID discarded).

CLAUDE.md and MEMORY.md persist across reset — behavioural memory intact.
Context injection on reset is handled by the diary layer
(`specs/v1/memory-diary.md`).

## Session switching

| Trigger               | Mechanism                            | Result                         |
| --------------------- | ------------------------------------ | ------------------------------ |
| Idle timeout          | Gateway discards stored ID           | New session                    |
| Stale/rejected ID     | SDK resume fails, gateway falls back | New session                    |
| Agent request         | IPC `type:'reset_session'`           | Gateway clears ID, new session |
| User keyword (`/new`) | Gateway detects before routing       | Gateway clears ID, new session |

## Pull (on demand)

`sessions-index.json` at
`/home/node/.claude/projects/-workspace-group/sessions-index.json`
maps each session ID to a Claude Code-generated summary. Readable by
the agent via file tools.

JSONL transcripts are not useful to the agent directly (SDK internal
format). Exposing them via an MCP tool is kept open.

## Open

1. **SDK resume failure handling** — detect when the SDK rejects a stale
   session ID, clear stored ID, fall back to new session gracefully.
   Currently unhandled: unknown whether the SDK throws, returns an error
   field, or silently starts fresh.

2. **Auto-compact session ID** — verify in our container setup whether
   auto-compact changes the session ID. If it does, `newSessionId` must
   always be stored. If it doesn't, the current code already handles it.

3. **`sessions` table collapse** — collapse into
   `registered_groups.session_id` column (see `specs/v1/db-bootstrap.md`).
   Cleanup, not blocking.

4. **`reset_session` IPC message** — not yet defined in
   `specs/v1/ipc-signal.md` or wired in `src/ipc.ts`.

5. **User reset keyword** — `/new` detection in gateway message loop
   before routing to agent. Specced in `specs/v1/commands.md` (`/new`
   section): clear session ID, forward args with `[system: user invoked
/new]` annotation, normal context injection (MEMORY.md, diary pointer)
   still applies. Not yet implemented.
