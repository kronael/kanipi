# 012 — Soul skill replaces character.json

character.json is removed. Agent personality is now defined by
the `soul` skill (`~/.claude/skills/soul/SKILL.md`).

## What changed

- `loadCharacter()` removed from agent-runner — no more bio/topics/adjectives
  randomization, no more ElizaOS-style character assembly
- `loadSoul()` reads `/workspace/group/SOUL.md` or `/workspace/share/SOUL.md`
  and appends to the system prompt
- Soul skill provides a default personality; group-level SOUL.md overrides it
- `/app/character.json` no longer exists in the container image

## What to do

- If you had a custom `character.json`, convert it to a `SOUL.md` file
  in your group directory with equivalent voice/style instructions
- The soul skill at `~/.claude/skills/soul/SKILL.md` provides the default
  personality — read it to understand the baseline
