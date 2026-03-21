---
status: spec
---

# Template Overlays

## Concept

Agent setup is layered: **default** base + **overlays** stacked on top.

```
templates/default/     base — always applied, full skill set, default instructions
templates/support/     overlay — replaces/merges specific files into default
templates/researcher/  overlay — replaces/merges specific files into default
templates/evangelist/  overlay — replaces/merges specific files into default
```

Overlays only carry what they change. Anything absent inherits from default.
The mechanism already exists for skills (`managed: local`, `disabled: true`
in SKILL.md frontmatter) — this spec extends it to the full setup: SOUL.md,
SYSTEM.md, CLAUDE.md, output-styles.

## What overlays can contain

```
templates/<name>/
  SOUL.md                   replaces default SOUL.md
  SYSTEM.md                 replaces default SYSTEM.md
  CLAUDE.md                 merged into default (sections appended)
  .claude/skills/           per-skill overrides (managed/disabled frontmatter)
  .claude/output-styles/    replaces matching output style files
```

Merge rules:

- **Replace**: SOUL.md, SYSTEM.md, output-styles — last overlay wins
- **Merge**: CLAUDE.md — overlay sections appended after default sections
- **Frontmatter-governed**: skills — existing `managed`/`disabled` flags apply

CLAUDE.md merge: append each top-level `##` section from the overlay that
doesn't already appear in the target by exact heading match.

## Deployment declaration

```
~/.claude/skills/self/TEMPLATES
```

Same location and pattern as `MIGRATION_VERSION` — a flat file the migrate
skill reads. One template name per line:

```
support
```

Default is always the base and never listed. Operator writes this file.
If a listed template doesn't exist at `/workspace/self/templates/<name>/`,
log a warning and continue.

## How it works — via migrate step d)

`/migrate`, after skill sync and migration runner, adds step d): if
`~/.claude/skills/self/TEMPLATES` exists:

1. Read overlay names from `~/.claude/skills/self/TEMPLATES`
2. For each overlay, in order, read from `/workspace/self/templates/<name>/`:
   - **SOUL.md** — copy over group root SOUL.md if present
   - **SYSTEM.md** — copy over group root SYSTEM.md if present
   - **CLAUDE.md** — merge: append sections absent from current `~/.claude/CLAUDE.md`
   - **skills/** — copy overrides, respect `managed`/`disabled` frontmatter
   - **output-styles/** — copy over matching files
3. Write `~/.claude/skills/self/TEMPLATES.applied` — timestamp + hash of inputs

## What changes

| Component                    | Change                         |
| ---------------------------- | ------------------------------ |
| `migrate/SKILL.md`           | Add overlay sync step d)       |
| `migrations/044-overlays.md` | Documents TEMPLATES convention |

No gateway code, no CLI changes, no DB changes.

## Acceptance criteria

- Operator writes `~/.claude/skills/self/TEMPLATES` containing `support`, runs `/migrate`
- Agent copies support SOUL.md, SYSTEM.md, skill overrides into place
- Re-running `/migrate` is idempotent
- Groups without TEMPLATES: zero behavior change
- Missing template name: warning logged, migrate continues
- `~/.claude/skills/self/TEMPLATES.applied` written after each sync
