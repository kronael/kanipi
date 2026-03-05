# Memory: Managed — shipped

Claude manages two persistent memory files across sessions.

## Two mechanisms

### CLAUDE.md — instructions and context

Loaded as system context on every session. Contains behavioural instructions,
project conventions, tool guidance. Seeded from `container/CLAUDE.md` on
first spawn (one-time copy, agent can modify freely).

`~/.claude/CLAUDE.md` = per-group instructions.
`/workspace/global/CLAUDE.md` = instance-wide instructions, mounted
read-only into non-main groups via `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.

### MEMORY.md — auto-memory

Claude Code's auto-memory system ([docs](https://code.claude.com/docs/en/memory)).
Stored at `~/.claude/projects/<project>/memory/MEMORY.md` where `<project>`
is derived from the agent's cwd (`/workspace/group` → `-workspace-group`).

- **First 200 lines loaded at every session start** — agent always sees it
- Beyond 200 lines is truncated at load time — agent keeps it concise
- Agent offloads detail into topic files (`debugging.md`, `patterns.md` etc.)
  and reads them on demand
- Enabled via `CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0"` in settings.json
  (already set by container-runner on first spawn)

Agent writes to MEMORY.md autonomously when it decides something is worth
remembering across sessions: build commands, debugging insights, user
preferences, architecture notes.

## What survives session resets

Both files are in `data/sessions/<folder>/.claude/` on the host, mounted
into the container. They survive idle timeout and container restart — the
agent picks up exactly where it left off in terms of accumulated knowledge.

## Distinction

| File        | Purpose                        | Written by           | Loaded                                 |
| ----------- | ------------------------------ | -------------------- | -------------------------------------- |
| `CLAUDE.md` | Instructions, conventions      | Agent + gateway seed | Always, as system prompt               |
| `MEMORY.md` | Accumulated facts, preferences | Agent (auto-memory)  | First 200 lines always; rest on demand |

## Global memory

`/workspace/global/CLAUDE.md` is the instance-level instruction layer.
No equivalent global MEMORY.md yet — group-specific memories stay isolated.
Cross-group facts require either global CLAUDE.md (manual) or the facts
spec (`specs/v2/memory-facts.md`).

## Open

- Convention for what goes in CLAUDE.md vs MEMORY.md vs facts DB
- Structured sections in MEMORY.md so agent has a consistent schema to write to
- Global MEMORY.md for instance-wide accumulated knowledge (main group writes, others read)
