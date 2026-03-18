---
status: spec
---

# Group Git Repos

Each group folder is an independent git repository. Parent repos are blind
to child group directories (child appears as untracked, gitignored in parent).

## Layout

```
groups/root/           ← git repo (.gitignore includes: atlas/)
groups/atlas/          ← git repo (.gitignore includes: support/)
groups/atlas/support/  ← git repo
```

Nested git repos work without submodules — each repo manages its own
versioned files, and parent repos simply gitignore child group dirs.

## What is versioned (per group repo)

- `CLAUDE.md`, `SOUL.md`, `SYSTEM.md`
- `facts/*.md`
- Any config files the agent creates

## What is NOT versioned (gitignored per group repo)

- `diary/`, `episodes/`, `users/`, `logs/`, `media/`, `tmp/`
- `*.jl` session transcripts

## CLI

```bash
# Initialize a group folder as a git repo
kanipi git-init <folder>
# Resolves group folder under GROUPS_DIR, runs git init,
# writes .gitignore with runtime exclusions and child group dirs.

# Clone a group config from a remote repo
kanipi create --from <repo-url> <name>
# Clones into the group folder instead of copying from template.
# Still registers group in DB and generates systemd unit.
```

## Agent awareness

The agent is informed about the git layout via the `git-repo` skill in
`~/.claude/skills/git-repo/SKILL.md`. The skill documents what to version,
what to ignore, and common git operations using `~/` paths.

## Scope

Each group manages its own repo independently. No cross-group git operations.
Remote configuration (push/pull) is left to the operator or agent after init.
