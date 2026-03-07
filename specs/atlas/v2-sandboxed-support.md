# Atlas v2: Sandboxed Support Agent

## Problem

Atlas v1 agent has full Claude Code capabilities — it can modify
CLAUDE.md, skills, facts, and system files. A public-facing support
agent must not be able to change its own instructions or corrupt
the knowledge base. Users should get answers, not an agent that
rewrites itself.

## Architecture: Frontend + Backend Split

Two agents using the group permission tiers from
`specs/v1m1/group-permissions.md`. The frontend is restricted
(depth 2), the backend is a worker (depth 1).

```
atlas/                  → world root (admin)
  atlas/support         → worker (research backend, writes facts/)
    atlas/support/web   → restricted (user-facing frontend)
```

```
user question
  ↓
atlas/support/web (restricted, read-only facts, escalate-only)
  ↓ escalate to parent
atlas/support (worker, full access to facts/, refs/, skills)
  ↓ returns findings
atlas/support/web
  ↓ surfaces answer to user
```

### Frontend agent (atlas/support/web — restricted)

- Read-only access to facts/ (search, not write)
- NO access to CLAUDE.md, skills, memory files
- NO file write tools
- Can answer from existing facts directly
- Delegates to backend when facts are insufficient
- Formats and presents backend findings to user

### Backend agent (researcher)

- Full access: facts/, refs/codebase/, skills
- Can write new facts, trigger deep research
- NOT exposed to user messages directly
- Receives structured research requests from frontend
- Returns structured findings (not raw chat)

## Implementation

Depends on `specs/v1m1/group-permissions.md` — the hierarchy-implied
permission system. No additional permission code needed beyond what
that spec provides:

- Restricted tier gives ro mounts, no CLAUDE.md write
- Escalation action lets frontend ask backend for help
- Worker tier gives backend full rw to facts/ and refs/

### Setup

```bash
# Create world
kanipi config marinade group add telegram:-5174030672 atlas
# Create backend (worker, depth 1)
kanipi config marinade group add telegram:-5174030672 atlas/support
# Create frontend (restricted, depth 2)
kanipi config marinade group add telegram:-5174030672 atlas/support/web
```

Frontend CLAUDE.md: search facts, answer directly if found,
escalate to parent if not. Backend CLAUDE.md: research deeply,
write new facts, return findings.

## Open Questions

- How does frontend detect "I need to escalate"? Threshold on
  fact search results? Explicit "I don't know" detection?
- Latency: escalation adds a round trip. Cache common answers?
- Should backend findings be persisted (new facts) or ephemeral?
- Escalation format: structured JSON or free-text prompt?

## Interim

Until group-permissions spec ships: single agent with CLAUDE.md
rules that say "don't modify system files." Works until users
find prompt injection vectors.
