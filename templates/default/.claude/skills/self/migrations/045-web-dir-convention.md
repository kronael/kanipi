---
version: 45
description: web path convention now in /web skill; self and CLAUDE.md reference it
---

## What changed

WEB_DIR convention is authoritative in the `/web` skill. `self/SKILL.md` and
`~/.claude/CLAUDE.md` now point there instead of restating it.

## Why

Agents building pages ad-hoc were ignoring the convention because it wasn't
where they looked. Root cause: world-admin groups (tier 1) were writing to
`/workspace/web/$GROUP_FOLDER/` instead of `/workspace/web/` — one level too
deep, because the mount is already world-scoped.

## Action

If you have misplaced content at `/workspace/web/$NANOCLAW_GROUP_FOLDER/`
and you are tier 1, move it up:

```bash
if [ "$NANOCLAW_IS_WORLD_ADMIN" = "1" ]; then
  ls /workspace/web/$NANOCLAW_GROUP_FOLDER/ 2>/dev/null && echo "misplaced content — move up one level"
fi
```
