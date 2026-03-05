# Memory: Managed — shipped

Claude Code's built-in persistent memory across sessions.
No custom code required — fully handled by the Claude Code runtime.

## Mechanisms

### CLAUDE.md — instructions

Loaded as system context on every session. Contains behavioural instructions,
project conventions, tool guidance. Seeded from `container/CLAUDE.md` on
first group spawn (one-time copy, agent can modify freely after).

- `~/.claude/CLAUDE.md` — per-group
- `/workspace/global/CLAUDE.md` — instance-wide, mounted read-only into
  non-main groups via `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`

### MEMORY.md — auto-memory

Stored at `~/.claude/projects/<project>/memory/MEMORY.md` where `<project>`
is derived from cwd (`/workspace/group` → `-workspace-group`).

- First 200 lines loaded at every session start automatically
- Agent offloads detail into topic files (`debugging.md`, `patterns.md`)
  alongside MEMORY.md and reads them on demand with standard file tools
- Agent writes autonomously when it decides something is worth keeping:
  user preferences, recurring context, architecture notes
- Enabled via `CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0"` in settings.json
  (set by gateway on first container spawn)

### How the agent writes memory

No special MCP tools — agent writes MEMORY.md and topic files directly
using its standard file editing tools (Write, Edit). Claude Code loads
MEMORY.md at session start; the agent decides what goes in it.

## Persistence

Both files live in `data/sessions/<folder>/.claude/` on the host, mounted
into the container at `/home/node/.claude`. Survive idle timeout, container
restart, and session reset.

## Summary

| File               | Loaded                       | Written by           | Scope     |
| ------------------ | ---------------------------- | -------------------- | --------- |
| `CLAUDE.md`        | Always, as system prompt     | Agent + gateway seed | Per-group |
| `MEMORY.md`        | First 200 lines always       | Agent (file tools)   | Per-group |
| `global/CLAUDE.md` | Always (non-main, read-only) | Main group agent     | Instance  |

## Open

- Global MEMORY.md (main group writes, others read) — no equivalent yet
- Convention for CLAUDE.md vs MEMORY.md vs facts DB (see `memory-facts.md`)
