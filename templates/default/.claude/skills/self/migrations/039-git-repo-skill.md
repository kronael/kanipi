# Migration 039: git-repo skill

Added `git-repo` skill to `~/.claude/skills/git-repo/SKILL.md`.

Each group folder can be an independent git repository. The skill documents:

- What files to version (CLAUDE.md, SOUL.md, facts/)
- What to gitignore (diary/, episodes/, users/, logs/, media/, tmp/, \*.jl)
- Common git operations using `~/` paths

Use `kanipi git-init <instance> <folder>` to initialize a group as a repo.
Use `kanipi create --from <repo-url> <name>` to clone a group config.
