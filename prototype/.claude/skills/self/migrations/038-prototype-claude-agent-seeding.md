# Migration 038: prototype/.claude/ as agent seeding source

Agent content (skills, CLAUDE.md, output-styles) has moved from `container/`
to `prototype/.claude/` in the kanipi repo. The gateway now seeds from
`prototype/.claude/` instead of `container/`. No agent-side changes required —
the seeded paths inside the container (`~/.claude/skills/`, etc.) are unchanged.
