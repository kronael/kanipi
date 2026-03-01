# CLI spec (v1)

Replace bash entrypoint with nest-commander TypeScript CLI.
Bun shebang, runnable via `bunx github:user/kanipi`.

## Commands

```
kanipi create <name>         seed data dir, .env, systemd unit
kanipi run <instance>        start gateway + vite (current entrypoint logic)
kanipi group list <instance> show registered + discovered groups
kanipi group add <instance> <jid> [folder]
kanipi group rm <instance> <jid>
```

## Design

- nest-commander with flat subcommands (no deep nesting)
- `kanipi <command> <action>` is the deepest level
- bun shebang: `#!/usr/bin/env bun`
- single `cli.ts` entrypoint, commands in `cli/` directory
- reuse `src/db.ts` for all DB operations
- config resolution: same as current (.env in data dir)

## group add

- First group defaults to folder=main, requires_trigger=0
- Subsequent groups require folder arg, requires_trigger=1
- trigger_pattern=@ASSISTANT_NAME when requires_trigger=1
- Creates groups/$folder/logs/ directory

## group rm

- Refuses to delete main group (folder='main')
- Keeps group folder on disk (data preservation)
- Deletes row from registered_groups

## group list

- Prints registered groups (jid, folder, trigger mode)
- Prints discovered chats (from chats table, is_group=1)
  that are not yet registered
