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
- **Merge**: CLAUDE.md — overlay sections appended/overriding default
- **Frontmatter-governed**: skills — existing `managed`/`disabled` flags

## Deployment declaration

```
groups/<folder>/OVERLAYS
```

One template name per line, in application order:

```
support
```

Default is always the base and never listed. Operator writes this file.
No gateway changes, no DB changes. The LLM does the rest.

## How it works — entirely via migration

`/migrate`, after skill sync and migration runner, if `~/OVERLAYS` exists:

1. Read overlay names from `~/OVERLAYS`
2. For each overlay, in order, read from `/workspace/self/templates/<name>/`:
   - **SOUL.md** — copy over group root SOUL.md if present
   - **SYSTEM.md** — copy over group root SYSTEM.md if present
   - **CLAUDE.md** — merge: append sections absent from current CLAUDE.md
   - **skills/** — copy overrides, respect `managed`/`disabled` frontmatter
   - **output-styles/** — copy over matching files
3. Write `~/OVERLAYS.applied` — timestamp + hash of inputs

No code changes needed. Operator creates OVERLAYS file, runs `/migrate`,
agent applies everything.

## What changes

| Component                    | Change                        |
| ---------------------------- | ----------------------------- |
| `migrate/SKILL.md`           | Add overlay sync step         |
| `migrations/044-overlays.md` | Documents OVERLAYS convention |

That's it. No gateway code, no CLI changes, no DB changes.

## Acceptance criteria

- Operator writes `groups/root/OVERLAYS` containing `support`, runs `/migrate`
- Agent copies support SOUL.md, SYSTEM.md, skill overrides into place
- Re-running `/migrate` is idempotent
- Groups without OVERLAYS: zero behavior change
- `~/OVERLAYS.applied` written after each sync
