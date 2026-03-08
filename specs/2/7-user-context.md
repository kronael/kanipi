# User Context

**Status**: open

Per-user memory for audience agents. The agent knows who it's talking to.

See `specs/1/K-knowledge-system.md` for memory layer overview.

## Problem

In a group with many users, the agent treats every message the same.
No memory of past interactions, preferences, expertise level, or
ongoing conversations with each user.

## Design

One file per user, managed by the agent:

```
/workspace/group/users/<user-id>.md
```

Agent creates and updates the file as it learns about the user.
Gateway injects a summary from the user's file when their message arrives.

### File format

```markdown
---
name: Alice
first_seen: 2026-03-06
last_seen: 2026-03-06
---

Backend developer. Works on validator-bonds.
Asked about bond collateral mechanics, SAM auction flow.
Prefers concise answers with code references.
```

Frontmatter: identity fields (name, dates, IDs).
Body: free-form agent-written notes. Short. Updated over time.

### Injection

When a message arrives from user X:

1. Gateway reads `users/<user-id>.md`
2. Extracts YAML frontmatter summary (or first N lines of body)
3. Injects into agent prompt: `<user name="Alice">Backend developer...</user>`
4. Agent sees context before responding

Like diary injection but keyed on sender, not date.

### Agent writes

Agent updates the file when it learns something notable:

- User's role or expertise area
- Recurring questions or interests
- Preferred communication style
- Ongoing tasks or threads

Agent should NOT log every interaction — just durable preferences
and knowledge. The file should stay short (<20 lines).

## Open

- User ID: per-channel (telegram user ID) or normalized cross-channel
- Privacy: user file access/deletion, GDPR
- Scope: per-group files or shared across groups
