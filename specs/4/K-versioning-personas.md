---
status: spec
---

# Composable Personas

## Problem

Deployment persona is a single manually-edited SOUL.md. No composable
units, no deployment-level declaration, no automated synthesis. Templates
exist and contain persona files but `kanipi create` never copies them into
the group folder — the operator does it manually every time.

## Insight

Templates are already the persona unit. Three small changes realize the
full system with no new abstractions, no plugin registry, no DB columns.

## Persona Components

Each template directory is a persona component. Files that participate:

```
templates/<name>/
  PERSONA.md          name, description, conflicts, priority
  SOUL.md             persona fragment (voice, values, identity)
  CLAUDE.md           instruction overrides
  SYSTEM.md           system prompt (replaces default; last persona wins)
  .claude/skills/     skill overrides (managed: local protects from /migrate)
```

All files are optional. A template with only `.claude/skills/` overrides
is a skill pack. A template with only SOUL.md + CLAUDE.md is a voice overlay.

`PERSONA.md` frontmatter:

```yaml
---
name: support
description: Support bot — patient, user-focused, no dev content
conflicts: [researcher]
priority: 10
---
```

## Deployment Declaration

```
groups/<folder>/PERSONAS
```

One template name per line. Created by `kanipi create` (writes the chosen
template name). Operator edits to add/remove personas. No DB changes.

```
support
facts-verifier
```

## Composition — migrate skill

When `/migrate` runs (root group), after skill sync and migration runner,
if `~/PERSONAS` exists:

1. Read persona names from `~/PERSONAS`
2. For each name, locate `/workspace/self/templates/<name>/`
3. Collect SOUL.md fragments (in PERSONAS file order)
4. **LLM-compose** a unified `~/SOUL.md` — synthesize into one coherent
   voice, do not concatenate. The agent writes it.
5. Merge CLAUDE.md — append non-duplicate content per persona
6. Copy `.claude/skills/` overrides per persona (respect `managed: local`)
7. SYSTEM.md: highest-priority persona wins; warn if ambiguous
8. Write `~/PERSONAS.composed` — timestamp + hash of inputs

Step 4 is the key: the agent synthesizes a persona that reads as one voice,
not a mechanical join.

## What changes

| Component                               | Change                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/cli.ts` `create()`                 | Copy template SOUL.md, CLAUDE.md, SYSTEM.md, skills into `groups/root/`; write `PERSONAS` file |
| `templates/*/PERSONA.md`                | Add to: default, support, evangelist                                                           |
| `migrate/SKILL.md`                      | Add step: compose personas if `~/PERSONAS` present                                             |
| `migrations/044-persona-composition.md` | Documents convention; no filesystem changes                                                    |

## What does not change

- No DB changes — PERSONAS is a flat file
- No gateway runtime changes — all composition is agent-side
- No new abstractions — templates are already the unit
- Groups without PERSONAS: `/migrate` behaves exactly as today
- Per-group (non-root) persona: root composes, child inherits via ro mount

## Conflict detection

- `conflicts:` in PERSONA.md — warn if conflicting personas both active
- Multiple SYSTEM.md — warn + use highest priority; operator resolves

## Acceptance criteria

- `kanipi create --template support` auto-populates `groups/root/PERSONAS`,
  SOUL.md, SYSTEM.md from template — no manual copying
- `/migrate` on root with `~/PERSONAS` produces a composed `~/SOUL.md`
  that reads as one coherent voice
- Adding a second persona to PERSONAS and re-running `/migrate` updates SOUL.md
- Groups without PERSONAS: `/migrate` unchanged
- `~/PERSONAS.composed` written after each successful composition run
