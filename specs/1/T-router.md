# Router

**Status**: shipped

Message routing: JID resolution, group dispatch, prompt
assembly, volume mounts.

## Current flow

```
Channel inbound
  -> onMessage(chatJid, message, attachments?, download?)
    -> storeMessage           (db.ts)
    -> enqueueEnrichment      (mime-enricher.ts)
    -> queue.push(chatJid)    (group-queue.ts)

Queue drains -> processGroupMessages(chatJid)  (index.ts)
  1. registeredGroups[chatJid] lookup
  2. findChannel(channels, chatJid)
  3. getMessagesSince(chatJid, cursor)
  4. trigger check (non-root)
  4b. routing rules (resolveRoutingTarget)
      - self-target (target === folder): skip, fall through
      - authorized target: delegate, return
      - unauthorized: log warn, fall through
  5. session history injection (new session only)
  6. new-day trigger
  7. flushSystemMessages(groupFolder)
  8. waitForEnrichments(msgIds)
  9. formatMessages(messages)       (router.ts)
  10. runContainerAgent(group, prompt, ...)
      -> buildVolumeMounts(group)
      -> spawn docker container
```

## Components

### JID -> group resolution

`registeredGroups`: flat `Record<string, RegisteredGroup>`
from DB. Exact match. Worlds spec adds glob via minimatch.

### JID -> channel resolution

`findChannel()` iterates channels, `ownsJid(jid)` prefix
match. First match wins.

### Prompt assembly

```
[system messages]     <- flushSystemMessages()
[pending /new args]
<messages>            <- formatMessages(), new session only
  <message sender="..." time="...">content</message>
</messages>
```

On resume: system messages (if queued) + raw user message.

### Volume mount assembly

| Mount              | containerPath              | Condition   |
| ------------------ | -------------------------- | ----------- |
| group folder       | `/workspace/group`         | always      |
| media dir          | `/workspace/media`         | always      |
| kanipi source      | `/workspace/self`          | always (ro) |
| world share dir    | `/workspace/share`         | always      |
| .claude (sessions) | `/home/node/.claude`       | always      |
| IPC dir            | `/workspace/ipc`           | always      |
| agent-runner src   | `/app/src`                 | always      |
| additional mounts  | `/workspace/extra/<name>`  | config      |
| web dir            | `/workspace/web`           | WEB_DIR     |
| sessions dir       | `/workspace/data/sessions` | root only   |

Skills seeded into `.claude/skills/` on first spawn.

## Open

### formatMessages improvements

- `ago` attribute, `<in_reply_to>` child (channels.md)
- 30 msgs / 2 days limit (memory-messages.md)

### Glob routing (worlds.md)

Exact -> glob fallback. minimatch patterns, most-specific
wins. Enables catch-all groups and topic routing.

### Volume mount extensibility

Hardcoded, fine for v1 (10 mounts). Declarative registry
if plugins contribute mounts (v2).

### Prompt assembly extensibility

Sequential steps with data deps, fine for v1. Stage
pipeline if steps become plugin-contributed (v2).
