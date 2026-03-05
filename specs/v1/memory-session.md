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

## Context injection on reset

On session reset, the gateway enqueues system messages (see
`specs/v1/system-messages.md`) before the next user message:

```xml
<system origin="gateway" event="new-session">
  <previous_session id="9123f10a"/>
  <previous_session id="fa649547"/>
  <previous_session id="3c8a12bb"/>
</system>
<system origin="diary" date="2026-03-04">discussed API design and auth flow</system>
```

- **Session ID history**: last 3 session IDs are injected so the agent can
  trace continuity if needed. Agent can read the `.jl` transcript via file
  tools for deeper inspection. IDs stored in DB alongside stored session ID.
- **Diary pointer**: last diary entry summary, produced by the diary layer
  (`specs/v1/memory-diary.md`). If no diary exists, origin omitted.
- **MEMORY.md**: always loaded automatically by the SDK project-memory
  mechanism — no explicit injection needed.

This is the full context bootstrap. The agent receives these before the first
user message of the new session.

## Session switching

| Trigger               | Mechanism                            | Result                         |
| --------------------- | ------------------------------------ | ------------------------------ |
| Idle timeout          | Gateway discards stored ID           | New session                    |
| Stale/rejected ID     | SDK resume fails, gateway falls back | New session                    |
| Agent request         | IPC `type:'reset_session'`           | Gateway clears ID, new session |
| User keyword (`/new`) | Gateway detects before routing       | Gateway clears ID, new session |

## Agent skills

The agent must know:

- Session IDs injected on reset and what they mean
- Where `.jl` transcripts live (`~/.claude/projects/<slug>/<uuid>.jl`)
- That raw JSONL is SDK-internal and hard to parse directly
- System message origins it will receive (`gateway`/`new-session`, `diary`)
- How to read diary files for continuity when needed

This is documented in `container/skills/self/SKILL.md` (self-persona skill,
agent-side) and a section in the global `container/agent-runner/CLAUDE.md`
(loaded into every session by the SDK). The global CLAUDE.md covers the basic
filesystem layout; SKILL.md covers behaviour (what to do on reset, how to
read past sessions if the user asks).

## Pull (on demand)

Agent can read individual `.jl` transcripts directly via file tools.
Raw JSONL is SDK-internal format — not easily parseable directly. The agent
should use it only for specific continuity lookup (e.g. user asks "what did
we discuss last week") — not routine. No index file exists.

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
- SDK resume failure handling is more urgent than it appeared —
  rhias would lose 4 days of context on first stale-ID incident
- Diary flush on session end is in `specs/v1/memory-diary.md`

## Open

1. **Gateway error handling on `status: error`** — runner fix shipped
   (`specs/res/ex-1.md`). Gateway still needs to: clear stored session ID
   on error response and send user a message to retry. Implement in
   `container-runner.ts` / call site in `group-queue.ts`.

2. **Auto-compact session ID** — **verified (ex-2)**:
   auto-compact keeps the same session ID and same `.jl` file. No fix needed.

3. **Session ID history injection** — on reset, inject last 3 session IDs
   via `<system origin="gateway" event="new-session">`. Requires storing session ID
   history (last 3) in DB alongside current session ID.

4. **Agent skills** — document session layout and system messages in
   `container/skills/self/SKILL.md` and agent `CLAUDE.md`.

5. **`sessions` table collapse** — collapse into
   `registered_groups.session_id` column (see `specs/v1/db-bootstrap.md`).
   Cleanup, not blocking.

6. **`reset_session` IPC message** — not yet defined in
   `specs/v1/ipc-signal.md` or wired in `src/ipc.ts`.

7. **User reset keyword** — `/new` detection in gateway message loop.
   Specced in `specs/v1/commands.md`. Not yet implemented.
