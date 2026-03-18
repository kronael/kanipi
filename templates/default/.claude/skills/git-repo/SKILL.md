---
name: git-repo
description: Manage this group's git repository. Use when asked to commit, push, pull, or version group files.
user-invocable: true
---

# Git Repo Skill

This group's folder is a git repository. You can version your own files.

## What is versioned

- CLAUDE.md, SOUL.md, SYSTEM.md
- facts/\*.md
- Any config files you create

## What is NOT versioned (.gitignored)

- diary/, episodes/, users/, logs/, media/, tmp/
- \*.jl session transcripts

## Child groups

Child group subdirectories are gitignored in this repo — each child manages its own repo independently.

## Common operations

- `git -C ~ status` — see what changed
- `git -C ~ add facts/topic.md && git -C ~ commit -m "fact: update staking rewards"` — commit a fact update
- `git -C ~ log --oneline -10` — recent history
- `git -C ~ pull` — pull updates from remote (if remote configured)

## Note

Use `~/` paths. Never commit diary/, episodes/, or users/ — they are runtime state.
