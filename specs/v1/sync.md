# Sync spec (v1) — solved

## Problem

Skills, agent code, and persona config need to flow from upstream
(repo/image) to running instances, with:

- Per-group isolation (each group can diverge)
- Agent-modifiable (leaf agent can customize its own skills)
- Versioned (upstream changes don't silently stomp local edits)
- Update path (agent or operator can pull upstream changes selectively)

## Solution

The `/migrate` skill + `MIGRATION_VERSION` system addresses all four
requirements:

- **Per-group isolation**: skills are seeded once into each group's session
  dir (`data/sessions/<group>/.claude/skills/`); groups diverge independently.
- **Agent-modifiable**: seeded files are agent-owned; gateway never
  overwrites after initial seed.
- **Versioned**: `container/skills/self/MIGRATION_VERSION` tracks gateway
  version; each group's session dir has its own copy after seeding.
- **Update path**: `/migrate` skill (main group) runs migration scripts from
  `container/skills/self/migrations/` to bring all groups up to the latest
  version. Gateway annotates agent prompts when a version gap is detected.

## Migration nudge

When the gateway spawns an agent whose group is behind the latest
`MIGRATION_VERSION`, it prepends an annotation to the prompt:

```
[pending migration] Skills version N < M. Run /migrate (main group) to sync all groups.
```

This surfaces in every group's first spawn after a gateway upgrade. The main
group agent can then run `/migrate` to apply all pending migrations.

## Known issues

- `template/workspace/skills/` — this directory is gone; those stale
  nanoclaw skill files (`info/SKILL.md`, `reload/SKILL.md`) are no longer
  present. Skills now seed from `container/skills/`.

## Related

- `specs/v1/cli.md` — CLI could expose `kanipi skills sync <instance>`
