---
status: shipped
---

# Commands

Gateway-intercepted commands live in `src/commands/`.

## Current commands

| Command      | Effect                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| `/new`       | clear current session, enqueue command context, preserve trailing args for next turn |
| `/ping`      | reply with bot status                                                                |
| `/chatid`    | reply with the current chat JID                                                      |
| `/stop`      | close active stdin / stop current active run for that chat                           |
| `/file put`  | upload attached file into workspace                                                  |
| `/file get`  | send file back from workspace                                                        |
| `/file list` | list files in workspace                                                              |

## Current model

- commands are intercepted before agent dispatch
- command registry is exported to `commands.xml`
- command handlers are normal gateway code, not agent tools

Some channels have native command affordances; kanipi uses
text-command interception for consistency.
