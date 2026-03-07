---
version: 15
description: permission tiers, NANOCLAW_TIER env var
---

## What changed

- New env var `NANOCLAW_TIER`: 0=root, 1=world, 2=agent, 3=worker
- Tier 2 agents: `~/.claude/` is read-only (skills, CLAUDE.md immutable)
  - `~/.claude/memory/` and `~/.claude/projects/` remain read-write
- Tier 3 workers: everything read-only except `/workspace/ipc/`
- `/workspace/self/` only mounted for tier 0 (root)
- `/workspace/web/` only mounted for tier 0 and 1

## Action required

Check tier: `echo "tier=$NANOCLAW_TIER"`
No action needed — changes are automatic via gateway mounts.
