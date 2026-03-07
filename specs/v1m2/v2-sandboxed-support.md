# Atlas v2: Sandboxed Support Agent

## Problem

Atlas v1 agent has full Claude Code capabilities — it can modify
CLAUDE.md, skills, facts, and system files. A public-facing support
agent must not be able to change its own instructions or corrupt
the knowledge base. Users should get answers, not an agent that
rewrites itself.

## Architecture: Agent + Worker Split

Three groups using the 4-tier permission model from
`specs/v1m1/permissions.md`.

```
atlas/                  → tier 1: world (admin, unrestricted)
  atlas/support         → tier 2: agent (research, rw workdir)
    atlas/support/web   → tier 3: worker (user-facing, ro)
```

```
user question
  ↓
atlas/support/web (worker, ro facts, escalate-only)
  ↓ escalate to parent
atlas/support (agent, rw workdir, writes facts/, refs/)
  ↓ returns findings
atlas/support/web
  ↓ surfaces answer to user
```

### Worker (atlas/support/web — tier 3)

User-facing. Minimal permissions.

- ro access to facts/ (search, not write)
- No access to CLAUDE.md, skills, memory files
- No file write tools
- Can answer from existing facts directly
- Escalates to parent when facts insufficient
- Formats and presents parent findings to user

### Agent (atlas/support — tier 2)

Research backend. Does the real work.

- rw workdir: facts/, refs/codebase/
- ro CLAUDE.md/skills (can't modify own setup)
- Can write new facts, trigger deep research
- Not exposed to user messages directly
- Receives structured research requests from worker
- Returns structured findings (not raw chat)

### World (atlas/ — tier 1)

Admin. Manages the support setup.

- rw everything in atlas/ tree
- Can modify CLAUDE.md, skills for children
- Monitors knowledge quality
- Not typically routed to directly

## Implementation

Depends on `specs/v1m1/permissions.md`. Permissions are
implied by folder depth — no additional permission code needed:

- Tier 3 (depth 3): ro mounts, send_message + escalate only
- Tier 2 (depth 2): workdir rw, ro setup, can delegate
- Tier 1 (depth 1): unrestricted within own world
- Escalation action lets worker ask agent for help

### Setup

```bash
# Create world (tier 1)
kanipi config marinade group add telegram:-5174030672 atlas
# Create agent (tier 2, research backend)
kanipi config marinade group add telegram:-5174030672 atlas/support
# Create worker (tier 3, user-facing frontend)
kanipi config marinade group add telegram:-5174030672 atlas/support/web
```

Worker CLAUDE.md: search facts, answer directly if found,
escalate to parent if not. Agent CLAUDE.md: research deeply,
write new facts, return findings.

## Open Questions

- How does worker detect "I need to escalate"? Threshold on
  fact search results? Explicit "I don't know" detection?
- Latency: escalation adds a round trip. Cache common answers?
- Should agent findings be persisted (new facts) or ephemeral?
- Escalation format: see specs/v2m1/escalation.md

## Interim

Until group-permissions spec ships: single agent with CLAUDE.md
rules that say "don't modify system files." Works until users
find prompt injection vectors.
