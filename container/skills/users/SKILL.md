---
name: users
description: Read or update user context files. Use when you need to
  remember something about a user or recall what you know about them.
user_invocable: true
arg: <user-id or action>
---

# User Context

`users/` stores per-user memory files. One file per sender.

## File format

```markdown
---
name: Alice
first_seen: 2026-03-06
---

Backend developer. Works on validator-bonds.
Prefers concise answers with code refs.
```

Frontmatter: identity fields. Body: notes about the user. Keep short (<20 lines).

## Reading

When the gateway injects `<sender id="tg-123456" file="users/tg-123456.md" />`,
that user has a context file. Read it if context would help your response.

No `file` attribute means no file exists yet.

## Writing

Update a user file when you learn something durable:

- Name or role
- Expertise areas
- Recurring interests
- Communication preferences

NOT every interaction — just stable knowledge worth remembering.

## File naming

Files are named by channel and platform ID:

- `tg-123456.md` — Telegram
- `wa-5551234.md` — WhatsApp
- `dc-789.md` — Discord
- `em-user@example.com.md` — Email

Use the `id` from `<sender>` tag for the filename.

## Usage

```
/users tg-123456        # read user file
/users update tg-123456 # update user file with new knowledge
```

When invoked without args, list all user files.
