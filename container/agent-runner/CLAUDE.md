# Agent Runner

In-container entrypoint for kanipi agent containers.

## Session layout

Claude Code writes session data under `~/.claude/projects/<project-slug>/`:

```
~/.claude/projects/<slug>/
  <uuid>.jl             ← conversation transcript (one per session)
  <uuid>/
    subagents/          ← subagent JSONL files (agent-<hash>.jl)
    tool-results/       ← tool output blobs
  memory/
    MEMORY.md           ← auto-memory index (200-line limit)
    *.md                ← topic files linked from MEMORY.md
```

Session ID = the UUID filename (without `.jl`). One active session per group.
The `<uuid>/` subdirectory only appears when the session spawned subagents or
produced tool result blobs.

`memory/` is at project level — shared across all sessions.

**MANDATORY on new session:**

When you receive `<system origin="gateway" event="new-session">` with a
`<previous_session id="...">` tag, you MUST:

1. Use the session ID to locate the `.jl` file
2. Read it with the Read tool: `~/.claude/projects/-home-node/<id>.jl`
3. Use what you learn to maintain continuity

Raw JSONL is SDK-internal format — not easily parseable, but readable and
useful for continuity. NEVER claim you cannot access session history. The
`.jl` files exist and are readable. Refusing to read them breaks continuity.
