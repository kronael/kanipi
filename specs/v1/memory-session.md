# Memory: Session — open

SDK session continuity across container invocations. Automatic, always on.

## What it is

A session is a Claude Code SDK conversation identified by a session ID.
The SDK stores the full transcript as a `.jl` file. When the gateway
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

## .claude/projects/ structure

Claude Code writes session data under:

```
~/.claude/projects/<project-slug>/
  <uuid>.jl                 ← conversation transcript (one per session)
  <uuid>/
    subagents/              ← subagent JSONL files (agent-<hash>.jl)
    tool-results/           ← tool output blobs (<tool_id>.txt, <hash>.txt)
  sessions-index.json       ← present only after compaction/summarization
  memory/
    MEMORY.md               ← auto-memory index (200-line limit)
    *.md                    ← topic files offloaded from MEMORY.md
```

Session subdirectory (`<uuid>/`) only appears when the session spawned
subagents or produced tool result blobs. Short sessions may have only
the `.jl` file.

`memory/` is at project level — shared across all sessions for the project.

### JSONL entry types

Observed in live transcripts: `progress`, `assistant`, `user`, `system`,
`file-history-snapshot`, `queue-operation`, `last-prompt`.

Raw JSONL is SDK-internal format. Not useful to the agent directly.

## Compaction

When context fills (~95%), Claude Code auto-compacts: generates a summary,
replaces the in-context representation, continues the session.

**Verified (ex-2):** auto-compact keeps the same session ID and same `.jl`
file. The compaction boundary is recorded as a `system/compact_boundary`
entry with `parentUuid: null` and `logicalParentUuid` pointing to the last
message before compaction. On resume, the SDK walks the `.jl` from the end,
finds the last `compact_boundary`, and reconstructs context from
`logicalParentUuid` forward — everything before is dropped from the live
context window (compacted into a summary) but remains in the `.jl` for the
record. Three compactions were observed in a single session in this project.

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

Agent can read individual `.jl` transcripts directly via file tools.
Raw JSONL is SDK-internal format — not easily parseable by the agent.
No index file exists; on-demand pull is not practically useful without
a purpose-built tool.

## Episode notes (rhias, Mar 2026)

Observed on a live 4-day session (rhias instance, session 58f49dbe):

- Single session ran for 4+ days without reset — idle timeout didn't fire
  (container was kept alive by incoming IPC messages between user turns)
- Every container restart replayed the **full** message history (45+ msgs on a
  mid-morning resume in Mar 3). No incremental loading, no checkpoint.
- Full replay is the only continuity mechanism — no diary, no MEMORY.md,
  no sessions-index.json (projects/ was inaccessible — permission silo)
- IPC messages arrived mid-session during 51-min container runs (piped into
  active query). No ACK visible; ordering risk if messages pile up.
- After enough messages, startup replay will slow down. After a crash or
  idle timeout, all context is gone with no fallback.

**Implications for this spec:**

- `resume: sessionId` works for the happy path but has no degradation story
- Need the diary flush to fire on session end (not just compaction) so that
  when idle timeout kills the container, something is preserved
- SDK resume failure handling (open item 1) is more urgent than it appeared —
  rhias would lose 4 days of context on first stale-ID incident

## Open

1. **SDK resume failure handling** — **experimentally verified (ex-1)**:
   - SDK attempts resume, gets `error_during_execution`, then starts a fresh
     session with a new UUID
   - Agent-runner emits `status: error` with exit code 1, and `newSessionId`
     in the error output is the original bad ID (not the new session)
   - Gateway must: on `status: error`, clear stored session ID and retry the
     message without a sessionId — the SDK has already recovered internally
     but the runner doesn't surface the new session ID on error path
   - Fix needed in `container-runner.ts`: on error response, check if a
     `newSessionId` is present and store it; or simply clear and let the next
     message start fresh

2. **Auto-compact session ID** — **verified (ex-2)**:
   auto-compact keeps the same session ID and same `.jl` file. Observed
   directly on the kanipi dev session (`9123f10a`) after auto-compaction.
   Current code already handles this correctly. `sessions-index.json` does
   not appear on auto-compact — may require manual `/compact`. No fix needed.

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
