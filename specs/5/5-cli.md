---
status: shipped
---

# CLI spec (v1)

TypeScript CLI (`src/cli.ts`) with manual arg parsing. Bash entrypoint
(`kanipi`) remains for docker deployments.

## Commands

```
kanipi create <name>                      seed data dir, .env, systemd unit
kanipi run <instance>                     start gateway + vite
kanipi config <instance> group list       show registered + discovered groups
kanipi config <instance> group add <jid> [folder]
kanipi config <instance> group rm <jid>
kanipi config <instance> user list|add|rm|passwd   manage web auth users
kanipi config <instance> mount list|add|rm         manage container mounts
```

## Design

- Manual argument parsing (no framework)
- `kanipi <command> <action>` is the deepest level
- Single `src/cli.ts` entrypoint
- Reuse `src/db.ts` for all DB operations
- Config resolution: same as current (.env in data dir)

## group add

- First group defaults to folder=root, requires_trigger=0
- Subsequent groups require folder arg, requires_trigger=1
- trigger_pattern=@ASSISTANT_NAME when requires_trigger=1
- Creates groups/$folder/logs/ directory

## group rm

- Refuses to delete root group (folder='root')
- Keeps group folder on disk (data preservation)
- Deletes row from registered_groups

## group list

- Prints registered groups (jid, folder, trigger mode)
- Prints discovered chats (from chats table, is_group=1)
  that are not yet registered
