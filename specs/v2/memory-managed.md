# Memory: Managed (CLAUDE.md) — shipped

Claude manages its own persistent memory via `~/.claude/CLAUDE.md`.

## Current state

Claude Code has a built-in auto-memory feature: it writes and updates
`~/.claude/CLAUDE.md` to persist facts, preferences, and context across
sessions. Enabled via:

```json
{ "env": { "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "0" } }
```

This is set in `data/sessions/<folder>/.claude/settings.json` on first
container spawn. The `.claude` directory is persisted on the host between
container runs — so CLAUDE.md survives session resets.

The agent runner also seeds `~/.claude/CLAUDE.md` from
`container/CLAUDE.md` on first spawn (one-time copy, agent can modify).

## What this provides

- Agent remembers user preferences ("Alice prefers bullet points")
- Agent notes recurring context ("this group is about the trading bot")
- Survives idle timeout and container restart
- Per-group: each group folder has its own `.claude/CLAUDE.md`

## Global CLAUDE.md

`/workspace/global/CLAUDE.md` is mounted read-only into non-main groups.
Loaded as additional system context via `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.
Main group has read-write access to seed/update global memory.

## Problems

**No structure**: CLAUDE.md is freeform. The agent appends and edits it but
there is no schema, no size limit, no compaction. Can grow stale or
contradictory over time.

**No cross-group sync for group-specific facts**: each group's CLAUDE.md is
isolated. If Alice tells the main group something, the agent in a secondary
group won't know unless it's in global CLAUDE.md.

## Open

- Define a size limit / compaction policy for CLAUDE.md
- Convention for what goes in group CLAUDE.md vs global CLAUDE.md
- Structured sections (e.g. `## Users`, `## Preferences`, `## Context`)
  so the agent has a consistent place to look and write
