# User Context

**Status**: impl-ready

Per-user memory files. Agent-controlled like facts.

## Design

One file per user, managed by the agent:

```
users/<channel>-<id>.md
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

### Gateway signal

Gateway injects a presence nudge, not the content:

```xml
<sender id="tg-123456" file="users/tg-123456.md" />
```

- `id`: channel-native sender ID
- `file`: path if file exists, omitted if no file yet

Agent decides when to read the file. No automatic injection of content.

### Agent reads/writes

Agent uses `/users` skill to:

- Read user file when context would help
- Write user file when learning something durable:
  - Role or expertise
  - Recurring interests
  - Preferred style

NOT every interaction — just stable knowledge.

## Scope

Per-group. `users/alice` in group A ≠ `users/alice` in group B.

Cross-channel identity (same person on telegram + whatsapp) is out of scope — see 5/9-identities.

## Changes

```
src/router.ts
  - inject <sender> tag with id + file presence

container/skills/users/SKILL.md
  - /users skill for read/write

container/CLAUDE.md
  - document users/ pattern
```

~5 lines gateway + skill.
