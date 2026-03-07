# Atlas v2: Sandboxed Support Agent

## Problem

Atlas v1 agent has full Claude Code capabilities — it can modify
CLAUDE.md, skills, facts, and system files. A public-facing support
agent must not be able to change its own instructions or corrupt
the knowledge base. Users should get answers, not an agent that
rewrites itself.

## Architecture: Frontend + Backend Split

Two agents, not one. The frontend is a restricted interface agent.
The backend is the full-capability research agent.

```
user question
  ↓
frontend agent (sandboxed, read-only)
  ↓ triggers research via delegation
backend agent (full access, facts/, refs/, skills)
  ↓ returns findings
frontend agent
  ↓ surfaces answer to user
```

### Frontend agent (interface)

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

## Implementation: Group Permissions

This requires a new permission level for groups. Currently groups
are either root (full access) or non-root (trigger mode). We need:

### Permission levels

| Level      | Can read    | Can write   | Can delegate    | Use case         |
| ---------- | ----------- | ----------- | --------------- | ---------------- |
| root       | everything  | everything  | yes             | admin, yonder    |
| standard   | group files | group files | yes             | current default  |
| restricted | facts/ (ro) | nothing     | yes (to parent) | support frontend |

### How restricted mode works

- Container mounts facts/ as read-only (no :rw)
- CLAUDE.md baked in, not writable by agent
- Skills limited to search/answer, no write skills
- Agent can call `delegate_group` to send research
  requests to parent (backend) group
- Parent returns findings, frontend presents to user

### Group config

```json
{
  "permission": "restricted",
  "parent": "main",
  "delegateOn": "knowledge_gap"
}
```

## Open Questions

- How does frontend detect "I need to delegate"? Threshold on
  fact search results? Explicit "I don't know" detection?
- Latency: delegation adds a round trip. Cache common answers?
- Should backend findings be persisted (new facts) or ephemeral?
- Can we reuse existing routing rules for the delegation, or
  does this need a new "research request" IPC type?
- Output styles: frontend needs channel-appropriate formatting,
  backend returns structured data

## Not Now

This is a design spec, not an implementation plan. Requires:

1. Container mount permission system (restricted mode)
2. Delegation protocol for research requests
3. Frontend CLAUDE.md that enforces read-only behavior
4. Backend group that accepts research requests

The simpler interim: single agent with CLAUDE.md rules that say
"don't modify system files." Works until users find prompt
injection vectors.
