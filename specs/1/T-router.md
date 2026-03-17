---
status: shipped
---

# Router

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
  1. getHubForJid(chatJid) → folder → groups[folder]
  2. findChannel(channels, chatJid)
  3. getMessagesSince(chatJid, cursor)
  4. resolveRoute(lastMsg, routes)
     - self-target (target === folder): skip, fall through
     - different target: delegatePerSender, return
  5. session history injection (new session only)
  6. new-day trigger
  7. flushSystemMessages(groupFolder)
  8. waitForEnrichments(msgIds)
  9. formatMessages(messages)       (router.ts)
  10. runContainerCommand(group, prompt, ...)
      -> buildVolumeMounts(group)
      -> spawn docker container
```

## Components

### JID -> group resolution

`getHubForJid(jid)`: queries the routes table for the first
default route target. Template targets like `atlas/{sender}`
return the base folder (strips last segment after `/`).
`groups`: flat `Record<string, GroupConfig>` from DB, keyed
by folder.

### JID -> channel resolution

`findChannel()` iterates channels, `ownsJid(jid)` prefix
match. First match wins.

### Prompt assembly

```
<clock time="..." tz="..." />        <- clockXml(), initial prompt only
[system messages]                    <- flushSystemMessages()
[pending /new args]
<messages>                           <- formatMessages(), new session only
  <message sender="..." sender_id="..." chat_id="..."
           platform="..." time="..." ago="...">content</message>
</messages>
```

On resume: system messages (if queued) + raw user message.

### Volume mount assembly

| Mount              | containerPath               | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
| ------------------ | --------------------------- | ------ | ------ | ------ | ------ |
| group folder       | `/home/node`                | rw     | rw     | rw     | ro     |
| media dir          | `/workspace/media`          | rw     | rw     | rw     | ro     |
| kanipi source      | `/workspace/self`           | ro     | —      | —      | —      |
| world share dir    | `/workspace/share`          | rw     | rw     | ro     | ro     |
| .claude (sessions) | `/home/node/.claude`        | rw     | rw     | rw     | rw     |
| IPC dir            | `/workspace/ipc`            | rw     | rw     | rw     | rw     |
| agent-runner src   | `/app/src`                  | rw     | rw     | rw     | rw     |
| additional mounts  | `/workspace/extra/<name>`   | config | config | config | config |
| web dir            | `/workspace/web`            | rw     | rw     | —      | —      |
| parent skills/     | `/home/node/.claude/skills` | —      | —      | ro     | ro     |

Skills seeded into `.claude/skills/` on first spawn.

## Open

### formatMessages improvements

- `ago` attribute, `<in_reply_to>` child (channels.md)
- 30 msgs / 2 days limit (memory-messages.md)

### Topic routing (S-topic-routing.md, not yet implemented)

`@agent` and `#topic` will be predefined route table entries
(type `prefix`, tiers 0-2). `@agent` delegates to child
group, `#topic` routes to named session within same group.
Requires new `prefix` route type in `routeMatches` that
matches `text.startsWith(match)`. Post-match dispatch in
`processGroupMessages` will handle @agent vs #topic
resolution. See `specs/3/S-topic-routing.md` for full spec.

### Volume mount extensibility

Hardcoded, fine for v1 (10 mounts). Declarative registry
if plugins contribute mounts (v2).

### Prompt assembly extensibility

Sequential steps with data deps, fine for v1. Stage
pipeline if steps become plugin-contributed (v2).
