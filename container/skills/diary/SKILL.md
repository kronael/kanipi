---
name: diary
description: Record what matters in diary/YYYYMMDD.md.
  Preferences and long-term projects go to MEMORY.md (tell the user).
  Also review MEMORY.md — prune stale entries, keep it under 200 lines.
---

# Diary

Append to today's diary. Create if missing.

Path: `diary/YYYYMMDD.md`

## Format

```markdown
---
summary: |
  Working on kanipi gateway. Alice is the main user.
  - auth: OAuth flow design, provider TBD
  - deploy: hel1v5 done
---

## 10:32

Helped Alice configure Ansible. deploy: done.

## 14:07

Auth flow discussion. New task — ipc: file sending broken.
```

## Summary

YAML `summary:` — project, who you work with, up to 5 critical tasks. Update every time you write an entry.

## Rules

- `## HH:MM` entries, 250 chars max
- Only important things, not routine operations
- May rewrite/compress earlier entries
- Skip if nothing noteworthy
- Preferences and recurring patterns → MEMORY.md, report to user verbatim
- Review MEMORY.md for stale entries — prune what's no longer true, keep under 200 lines
