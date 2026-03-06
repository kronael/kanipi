# Prompt format

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

## Message history format -- shipped

`formatMessages()` in `src/router.ts`:

```xml
<messages>
<message sender="Alice" time="2026-03-05T10:00:00Z">
  hey can you help
</message>
</messages>
```

Attributes: `sender` (name or raw ID), `time` (ISO 8601).
Content XML-escaped. `reply_to` not yet included.

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

Character context via `systemPrompt.append`:

- `/app/character.json` merged with
  `/workspace/share/character.json` (instance override)
- `/workspace/share/CLAUDE.md` appended for non-root only

Group CLAUDE.md at `/home/node/.claude/CLAUDE.md`, loaded
by SDK project-memory.

## Open

### reply_to threading

Described in `channels.md`, not yet emitted by
`formatMessages()`.

### XML throughout -- closed, won't do

XML for prompt content. JSON for SDK/machine interfaces.
See `specs/xml-vs-json-llm.md`.
