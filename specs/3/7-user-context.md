# User Context

**Status**: impl-ready

Per-user memory files. The agent knows who it's talking to.

## Design

One file per user, managed by the agent:

```
/workspace/group/users/<channel>-<id>.md
```

Examples: `tg-123456.md`, `wa-5551234.md`, `dc-789.md`

### File format

```markdown
---
name: Alice
first_seen: 2026-03-06
---

Backend developer. Works on validator-bonds.
Prefers concise answers with code refs.
```

Frontmatter: identity fields. Body: agent-written notes. Keep short (<20 lines).

### Injection

Message arrives from user X:

1. Gateway reads `users/<channel>-<id>.md`
2. Injects into prompt: `<user id="tg-123456" name="Alice">Backend dev...</user>`
3. Agent responds with context

Same pattern as diary injection, keyed on sender not date.

### Agent writes

Agent updates file when it learns something durable:

- Role or expertise
- Recurring interests
- Preferred style

NOT every interaction — just stable knowledge.

## Scope

Per-group. `users/alice` in group A ≠ `users/alice` in group B.

Cross-channel identity (same person on telegram + whatsapp) is out of scope — see 9-identities.

## Changes

```
src/index.ts or src/router.ts
  - readUserFile(folder, channelId): string | null
  - inject <user> block into prompt (alongside diary)

container/CLAUDE.md
  - document users/ pattern
  - when to write user files
```

~15 lines gateway + CLAUDE.md instruction.
