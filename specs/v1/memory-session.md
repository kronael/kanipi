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

### sessions-index.json

Written by Claude Code after compaction or summarization. Not always
present. Format:

```json
{
  "version": 1,
  "entries": [
    {
      "sessionId": "b0a5a2cd-...",
      "fullPath": "/home/node/.claude/projects/-workspace-group/b0a5a2cd.jl",
      "fileMtime": 1770032833624,
      "firstPrompt": "Implement the following plan...",
      "summary": "Fact Verification System with Header Updates",
      "messageCount": 31,
      "created": "2026-02-01T15:00:32.274Z",
      "modified": "2026-02-01T16:07:18.795Z",
      "gitBranch": "develop",
      "projectPath": "/workspace/group",
      "isSidechain": false
    }
  ]
}
```

The agent can read this file directly via file tools to discover past
sessions and their summaries.

### JSONL entry types

Observed in live transcripts: `progress`, `assistant`, `user`, `system`,
`file-history-snapshot`, `queue-operation`, `last-prompt`.

Raw JSONL is SDK-internal format. Not useful to the agent directly.

## Compaction

When context fills (~95%), Claude Code auto-compacts: generates a summary,
replaces the in-context representation, continues the session.

**Unverified**: whether auto-compact creates a new session ID and new `.jl`
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

Agent reads `sessions-index.json` and individual `.jl` transcripts
directly via file tools. `sessions-index.json` gives summaries without
parsing raw JSONL; present only after compaction.

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
