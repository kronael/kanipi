# 013 — CLAUDE.md: add Soul, Knowledge, Greetings sections

The seeded `~/.claude/CLAUDE.md` is missing the Soul, Knowledge,
and Greetings sections added in v0.7. Copy the latest from the
canonical source.

## Check

```bash
grep -q "^# Soul" ~/.claude/CLAUDE.md && echo "done" && exit 0
```

## Steps

```bash
cp /workspace/self/container/CLAUDE.md ~/.claude/CLAUDE.md
```

## After

```bash
echo 13 > ~/.claude/skills/self/MIGRATION_VERSION
```
