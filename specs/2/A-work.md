# Work — task state via MEMORY.md

**Status**: incomplete

## Decision

No separate work.md file. MEMORY.md already handles persistent
state per group. Adding another agent-controlled file creates
layer confusion (where do I write this?) without evidence of
benefit. brainpro's WORKING.md pattern is unvalidated in production.

## What we want

Better agent use of MEMORY.md for active task tracking. Two parts:

### 1. Agent instructions (CLAUDE.md)

Tell the agent to maintain a `## Current task` section in MEMORY.md:

```markdown
## Current task

Fixing hostPath() — mount translation breaks in docker-in-docker.
Blocked: need to test on sloth instance.
Next: rebuild image, deploy, verify IPC paths.
```

Updated naturally as the agent works. Cleared when done.
No new file, no new injection path.

### 2. /work skill (optional nudge)

Skill prompt that tells the agent: "review and update the
Current task section in your MEMORY.md." Useful as:

- Gateway-triggered nudge before idle timeout
- User-invoked to force a checkpoint
- Pre-session nudge if MEMORY.md has stale task info

The skill writes to MEMORY.md, not a separate file. It's a
behavioral prompt, not a storage layer.

## Gateway role

- Inject MEMORY.md on session start (already happens — Claude Code native)
- Optional: detect stale `## Current task` section (>24h unchanged)
  and annotate on next session start
- No new file mounts, no new injection paths

## Why not a separate file

- Agent already manages MEMORY.md — adding work.md splits attention
- More files = more reasoning tokens deciding where to write
- MEMORY.md is injected automatically — no gateway changes needed
- One unstructured file that the agent owns is simpler than two

## Open questions

- Should the gateway parse MEMORY.md to detect staleness, or
  just let the agent manage it?
- Is /work skill worth building, or are better CLAUDE.md
  instructions sufficient?
