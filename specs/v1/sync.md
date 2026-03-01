# Sync spec (v1) — open problem

## Problem

Skills, agent code, and persona config need to flow from upstream
(repo/image) to running instances, with:

- Per-group isolation (each group can diverge)
- Agent-modifiable (leaf agent can customize its own skills)
- Versioned (upstream changes don't silently stomp local edits)
- Update path (agent or operator can pull upstream changes selectively)

Currently unsolved. What exists:

- `container/skills/` → always overwritten by gateway on every spawn
  (agent edits don't persist, no versioning)
- `data/sessions/<group>/agent-runner-src/` → seeded once, agent owns it
  (persists but no upstream update path)
- `template/workspace/skills/` → seeded by `kanipi create`, never updated
  (stale after first deploy)

## The tension

**Always-sync** (gateway controls): consistent, updatable, but agent can't
customize. Good for built-in tools (`agent-browser`).

**Seed-once** (agent controls): agent can customize, but upstream changes
never reach it. Stale over time.

**Neither handles**: "sync upstream changes, but preserve local edits" —
i.e. a merge/diff model.

## Thinking

The agent itself could be the update mechanism — a `/reload` or `/sync`
skill that:

1. Pulls latest skill versions from a known upstream path (image or repo)
2. Diffs against local copies
3. Applies non-conflicting updates
4. Reports conflicts for human review

This would make updates explicit and agent-driven rather than implicit
gateway behavior. The gateway stays dumb (seed-once), the agent handles
versioning.

Open questions:

- What is "upstream"? The baked image (`/app/container/skills/`)?
  A git repo URL? An MCP server?
- How to represent versions? File hash? Git commit? Semver in SKILL.md?
- Who triggers sync? Operator via CLI? Agent on startup? Scheduled?
- What scope? Per-skill? Per-group? Per-instance?

## Known issues in current workspace skills

- `template/workspace/skills/info/SKILL.md` — references stale nanoclaw
  paths (`~/.openclaw/workspace/skills/`, `mcporter.json`). Needs updating
  to `~/.claude/skills/` and actual kanipi paths.
- `template/workspace/skills/reload/SKILL.md` — references `openclaw.mjs`
  and `openclaw.json` (nanoclaw). The `kill -TERM 1` part is correct for
  kanipi, the config reload section is stale.
- Neither `info` nor `reload` skills are currently reachable by the agent
  (skills not seeded into session — the unsolved problem above).

## Related

- `specs/v1/cli.md` — CLI could expose `kanipi skills sync <instance>`
