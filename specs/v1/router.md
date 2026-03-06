# Router

Message routing — JID resolution, group dispatch, prompt assembly,
volume mount assembly. The path from inbound message to running agent.

## Current flow

```
Channel inbound
  → onMessage(chatJid, message, attachments?, download?)
    → storeMessage(chatJid, message)           # db.ts
    → enqueueEnrichment(msgId, ...)            # mime-enricher.ts
    → queue.push(chatJid)                      # group-queue.ts

Queue drains → processGroupMessages(chatJid)   # index.ts
  1. registeredGroups[chatJid] lookup
  2. findChannel(channels, chatJid)
  3. getMessagesSince(chatJid, cursor)
  4. trigger check (non-root groups)
  5. session history injection (new session only)
  6. new-day trigger
  7. flushSystemMessages(groupFolder)
  8. waitForEnrichments(msgIds)
  9. formatMessages(messages)                   # router.ts
  10. prompt = sysXml + formatted
  11. runContainerAgent(group, prompt, ...)     # container-runner.ts
      → buildVolumeMounts(group)
      → spawn docker container
```

## Components

### JID → group resolution

`registeredGroups` is a flat `Record<string, RegisteredGroup>` loaded
from DB. Exact JID match. Worlds spec adds glob matching via minimatch
for pattern-based routing (`telegram/*` → catch-all group).

Code: `index.ts:registeredGroups`, `db.ts:getAllRegisteredGroups()`

### JID → channel resolution

`findChannel()` iterates channels, calls `ownsJid(jid)` — prefix
match. First match wins.

Code: `router.ts:findChannel()`

### Prompt assembly

Envelope built in `processGroupMessages()`:

```
[system messages]     ← flushSystemMessages()
[pending /new args]   ← pendingCommandArgs
<messages>            ← formatMessages() — only on new session
  <message sender="..." time="...">content</message>
</messages>
```

On session resume, system messages only (if queued), then the raw
user message piped to stdin. SDK transcript provides prior context.

Code: `index.ts:processGroupMessages()`, `router.ts:formatMessages()`

### Volume mount assembly

`buildVolumeMounts()` builds the container's filesystem view:

| Mount              | containerPath              | Condition       |
| ------------------ | -------------------------- | --------------- |
| group folder       | `/workspace/group`         | always          |
| media dir          | `/workspace/media`         | always          |
| kanipi source      | `/workspace/self`          | always (ro)     |
| world share dir    | `/workspace/share`         | always          |
| .claude (sessions) | `/home/node/.claude`       | always          |
| IPC dir            | `/workspace/ipc`           | always          |
| agent-runner src   | `/app/src`                 | always          |
| additional mounts  | `/workspace/extra/<name>`  | containerConfig |
| web dir            | `/workspace/web`           | WEB_DIR exists  |
| sessions dir       | `/workspace/data/sessions` | root only       |

Skills are seeded into `.claude/skills/` on first spawn (not a mount).
Settings injected per-spawn (WEB_HOST, ASSISTANT_NAME, IS_ROOT, SLINK_TOKEN).

Code: `container-runner.ts:buildVolumeMounts()`

### Outbound routing

`routeOutbound()` finds the channel by JID prefix and calls
`sendMessage()`. IPC dispatch in `ipc.ts` uses the same pattern.

Code: `router.ts:routeOutbound()`

## Open

### formatMessages improvements (specced)

- Add `ago` attribute to `<message>` elements
- Add `<in_reply_to>` child element for replies (channels.md)
- Message limit: 30 messages, 2 days (memory-messages.md)
- Older messages comment: `<!-- N older messages not shown -->`

### Glob routing (specced in worlds.md)

Current: exact JID → group match.
Target: minimatch patterns (`telegram/*`, `discord/guild:*`).
Router iterates registered patterns, first match wins. Enables
catch-all groups and topic/thread family routing.

### Volume mount extensibility

Current mount list is hardcoded — adding a mount means editing
`buildVolumeMounts()`. This is fine for v1 (10 mounts, clear
conditionals). If mounts become configurable per-group or
plugin-contributed, consider a declarative mount registry:

```typescript
interface MountProvider {
  name: string;
  mounts(group: RegisteredGroup): VolumeMount[];
}
```

Not needed until plugins can contribute mounts. Defer to v2.

### Prompt assembly extensibility

Steps in `processGroupMessages` are sequential with data
dependencies. Adding a step = adding code inline. Fine for v1.
If steps become plugin-contributed or per-group configurable,
extract to a stage pipeline. Defer to v2.

### Session-aware message injection

`<messages>` block injected on new session only (specced in
memory-messages.md). On resume, SDK transcript has full context.
Gateway determines new vs resume by checking `sessions[groupFolder]`.
