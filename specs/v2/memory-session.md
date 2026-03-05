# Memory: Session — shipped

Claude Code session continuity across container invocations.

## Current state

Each group has a persistent `~/.claude` directory mounted into its container
at `/home/node/.claude` (host path: `data/sessions/<folder>/.claude`).

The Claude Code SDK `resume: sessionId` option resumes a prior conversation
transcript. The agent runner:

1. Receives `sessionId` from gateway via stdin payload
2. Passes it to `query({ options: { resume: sessionId } })`
3. Returns `newSessionId` in output JSON
4. Gateway stores the new session ID in the `sessions` DB table
5. Next invocation receives the stored ID → continuous conversation

Session ID is per-group-folder. Each group has exactly one active session.

## Pre-compact hook

When Claude Code compacts a session (context window approaching limit), the
agent runner's `PreCompact` hook fires:

1. Reads the transcript JSONL from the session path
2. Parses messages into `ParsedMessage[]`
3. Writes a markdown archive to `/workspace/group/conversations/YYYY-MM-DD-<summary>.md`
4. Records entry in `sessions-index.json` alongside the session transcript

This gives a human-readable conversation history in the group folder.
The agent can read `conversations/` to recall prior sessions if needed.

## Problems

**Sessions table vs registered_groups**: `sessions` is a separate table with
`group_folder → session_id`. This is one-to-one with `registered_groups` and
should be a column there (see `specs/v1/db-bootstrap.md`).

**Session reset on idle**: gateway idle timeout kills the container. On next
start a new session begins. The old session transcript is still on disk but
the new session has no automatic link to it. Agent starts fresh unless it
explicitly reads `conversations/`.

**Interaction with message pipe**: on session reset, DB messages from the
prior session are re-piped as context but the SDK session is new — the agent
sees user messages without its own prior responses in SDK context. Can cause
confusion or repeated introductions.

## Open

- Collapse `sessions` table into `registered_groups.session_id` column
- On session reset, inject summary of previous session into first prompt
- Surface `conversations/` to agent automatically on new session start
