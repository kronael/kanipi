# Prompt format

**Status**: shipped

## Status key

- **shipped** -- implemented and running
- **open** -- specced, not implemented

## Current state (shipped)

| Part               | Format                   |
| ------------------ | ------------------------ |
| stdin payload      | JSON (`ContainerInput`)  |
| IPC files (in/out) | JSON                     |
| agent stdout       | JSON (`ContainerOutput`) |
| message history    | XML (`<messages>`)       |

## stdin payload -- shipped

```json
{
  "prompt": "<messages>...",
  "sessionId": "abc123",
  "groupFolder": "main",
  "chatJid": "tg:-100123456",
  "isScheduledTask": false,
  "assistantName": "Rhia",
  "secrets": { "ANTHROPIC_API_KEY": "..." }
}
```

| Field             | Type     | Notes                          |
| ----------------- | -------- | ------------------------------ |
| `prompt`          | string   | XML `<messages>` block         |
| `sessionId`       | string?  | Resume; omit for new           |
| `groupFolder`     | string   | Filesystem-safe folder name    |
| `chatJid`         | string   | Channel JID                    |
| `messageCount`    | number?  | Messages in this batch         |
| `delegateDepth`   | number?  | Delegation nesting depth       |
| `isScheduledTask` | boolean? | Scheduled task header if true  |
| `assistantName`   | string?  | `NANOCLAW_ASSISTANT_NAME` env  |
| `secrets`         | object?  | API keys; stripped, not logged |

## Prompt assembly order -- shipped

The `prompt` field in ContainerInput is assembled as:

```
clock header (clockXml)
  → system messages (flushSystemMessages)
  → pendingArgs (command context, if any)
  → message history (formatMessages)
```

`pendingArgs` is the raw text following a command trigger
(e.g., `/ask what is X` → `"what is X"`). Inserted between
system messages and message history so the agent sees it as
the most recent instruction before the conversation.

### Injection order

In `src/index.ts`, the prompt string is assembled as:

```
clock + '\n' + sysXml + '\n' + pendingArgs + '\n' + formatted
```

1. `clock` — `clockXml(TIMEZONE)`: `<clock time="..." tz="..." />`
   (UTC ISO 8601 + configured timezone, initial prompt only)
2. `sysXml` — flushed system messages (new-session, new-day)
3. `pendingArgs` — command context text, consumed once from
   `pendingCommandArgs` map (keyed by chatJid), deleted after read
4. `formatted` — `formatMessages()` output (XML `<messages>` block)

`pendingArgs` is stashed by `/new` (and similar commands) before
the message loop picks up the batch. It appears after system
messages but before conversation history, giving the agent a
one-shot instruction without polluting the message log.

## Message history format -- shipped

`formatMessages()` in `src/router.ts`:

```xml
<messages>
<message sender="Alice" sender_id="telegram:1112184352"
         chat_id="telegram:-1001234567890" chat="Support"
         platform="telegram" time="2026-03-05T10:00:00Z" ago="3h">
  hey can you help
</message>
</messages>
```

Attributes: `sender` (display name, falls back to sender ID),
`sender_id` (JID), `chat_id` (chat JID), `chat` (group name,
when is_group), `platform`, `time` (ISO 8601), `ago` (relative
time: s/m/h/d/w). Content XML-escaped. `forwarded_from` and
`reply_to` metadata included when present (see `formatMessages()`
in `router.ts`). See `specs/3/H-jid-format.md` for full attribute
table.

## Scheduled task header -- shipped

When `isScheduledTask` is true, agent runner prepends:

```
[SCHEDULED TASK - automatic, not from user/group.]
```

## Agent stdout -- shipped

JSON wrapped in sentinel markers:

```
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"...","newSessionId":"abc123"}
---NANOCLAW_OUTPUT_END---
```

| Field          | Type             | Notes                     |
| -------------- | ---------------- | ------------------------- |
| `status`       | `success\|error` |                           |
| `result`       | `string\|null`   | null = silent             |
| `newSessionId` | string?          | Persisted by host         |
| `error`        | string?          | When `status === 'error'` |

Multiple marker pairs per run (streaming). `<internal>`
tags in `result` stripped before sending.

## IPC files -- gateway-to-agent -- shipped

Gateway writes `.json` to `/workspace/ipc/input/`, sends
SIGUSR1. Agent polls on signal + 500ms fallback.

```json
{ "type": "message", "text": "<messages>...</messages>" }
```

`_close` sentinel (empty, no ext) ends agent loop.

## IPC files -- agent-to-gateway -- shipped

Agent writes to `/workspace/ipc/messages/` and
`/workspace/ipc/tasks/`. Gateway watches via `fs.watch`.

Message: `{ "type": "message", "chatJid": "...", "text": "..." }`
File: `{ "type": "file", "chatJid": "...", "filepath": "...", "filename": "..." }`
Task: `{ "type": "schedule_task", "targetJid": "...", ... }`

`filepath` must be under `/workspace/group/`.

## System context injection -- shipped

System context via `systemPrompt.append`:

- `/workspace/share/CLAUDE.md` appended for non-root only
- Soul personality via skill (`soul/SKILL.md`), not code injection
- Group-level `SOUL.md` override read by agent per CLAUDE.md instruction

Group CLAUDE.md at `/home/node/.claude/CLAUDE.md`, loaded
by SDK project-memory.

## Open

### reply_to threading -- shipped

`formatMessages()` emits `<forwarded_from>` and `<reply_to>`
XML elements when metadata is present. Channels (telegram,
whatsapp) extract forward origin and reply context and store
them on the message row.

### XML throughout -- closed, won't do

XML for prompt content. JSON for SDK/machine interfaces.
See `specs/res/xml-vs-json-llm.md`.
