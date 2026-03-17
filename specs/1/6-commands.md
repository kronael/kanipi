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

## Control commands (planned)

Registered like any other command. Execute before the container
run, bypass it if the command handles everything. Available to
any group but some are root-only (checked inside the handler).

| Command             | Scope | Effect                                 |
| ------------------- | ----- | -------------------------------------- |
| `/status`           | any   | reply with gateway uptime and health   |
| `/approve <jid>`    | root  | approve pending onboarding request     |
| `/reject <jid>`     | root  | reject and suppress onboarding request |
| `/restart <folder>` | root  | restart a group's container            |
| `/grant <f> <rule>` | root  | add a grant override for a group       |

## Notifications

`notify(text)` sends a gateway message to root's JIDs (looked
up from the routing table). Used for onboarding alerts, error
notifications, health events. Lives in `src/commands/notify.ts`.

Outbound notifications are recorded via `storeOutbound()` with
`source: 'control'`.

## Model

- Commands are intercepted before agent dispatch (message loop)
- Command registry is exported to `commands.xml`
- Command handlers are normal gateway code, not agent tools
- Root-only commands check `permissionTier(group.folder) === 0`
- Non-command messages proceed to agent normally

Some channels have native command affordances; kanipi uses
text-command interception for consistency.
