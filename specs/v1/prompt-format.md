# Prompt format

## Status key

- **shipped** — implemented and running in production
- **open** — specced but not yet implemented

## Current state (shipped)

| Part                       | Format                           |
| -------------------------- | -------------------------------- |
| stdin payload              | JSON (`ContainerInput`)          |
| IPC message files (input)  | JSON (`{ type, text }`)          |
| IPC message files (output) | JSON (`{ type, chatJid, text }`) |
| agent stdout               | JSON (`ContainerOutput`)         |
| message history in prompt  | XML (`<messages>`)               |

## stdin payload — shipped

The gateway serialises a `ContainerInput` object to JSON and writes it to the
container's stdin. The agent runner reads and parses it on startup.

```json
{
  "prompt": "<messages>\n<message sender=\"Alice\" time=\"2026-03-05T10:00:00Z\">hey</message>\n</messages>",
  "sessionId": "abc123",
  "groupFolder": "main",
  "chatJid": "tg:-100123456",
  "isMain": true,
  "isScheduledTask": false,
  "assistantName": "Rhia",
  "secrets": { "ANTHROPIC_API_KEY": "..." }
}
```

Fields:

| Field             | Type     | Notes                                           |
| ----------------- | -------- | ----------------------------------------------- |
| `prompt`          | string   | XML `<messages>` block (see below)              |
| `sessionId`       | string?  | Claude Code session to resume; omit for new     |
| `groupFolder`     | string   | Group folder name (filesystem-safe)             |
| `chatJid`         | string   | Channel JID (`tg:…`, `discord:…`, etc.)         |
| `isMain`          | boolean  | Whether this is the main (privileged) group     |
| `isScheduledTask` | boolean? | Agent prepends scheduled-task header if true    |
| `assistantName`   | string?  | Injected as `NANOCLAW_ASSISTANT_NAME` env var   |
| `secrets`         | object?  | API keys; stripped after SDK init, never logged |

`_annotations` (internal) — enricher strings prepended to `prompt` by the
gateway before serialisation. Never present in logs or on disk.

## Message history format — shipped

`formatMessages()` in `src/router.ts` produces the XML block that becomes the
`prompt` field:

```xml
<messages>
<message sender="Alice" time="2026-03-05T10:00:00Z">hey can you help</message>
<message sender="Bob" time="2026-03-05T10:00:01Z">sure what do you need</message>
</messages>
```

Attributes:

- `sender` — display name if known; falls back to raw sender ID
- `time` — ISO 8601 timestamp from the database record
- Content — XML-escaped user text (`escapeXml()` in `src/router.ts`)

`reply_to` is **not** currently included in `<message>` attributes.

## Scheduled task header — shipped

When `isScheduledTask` is true the agent runner prepends a plain-text header
before the message block:

```
[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]

<messages>…</messages>
```

## Agent stdout — shipped

Agent stdout carries JSON wrapped in sentinel markers. The gateway
stream-parses stdout for these markers.

```
---NANOCLAW_OUTPUT_START---
{"status":"success","result":"Here is the answer…","newSessionId":"abc123"}
---NANOCLAW_OUTPUT_END---
```

`ContainerOutput` fields:

| Field          | Type             | Notes                                      |
| -------------- | ---------------- | ------------------------------------------ |
| `status`       | `success\|error` |                                            |
| `result`       | `string\|null`   | Text to send to the channel; null = silent |
| `newSessionId` | string?          | Claude Code session ID; persisted by host  |
| `error`        | string?          | Present when `status === 'error'`          |

Multiple marker pairs may appear in one container run (streaming mode).

`<internal>` tags in `result` are stripped by `stripInternalTags()` before
sending to the user.

## IPC files — gateway-to-agent (input) — shipped

The gateway writes `.json` files to `/workspace/ipc/input/` and sends
SIGUSR1 to the container. The agent polls on signal + 500ms fallback.

```json
{ "type": "message", "text": "<messages>\n<message …>…</message>\n</messages>" }
```

A `_close` sentinel file (empty, no extension) tells the agent to end its
loop after finishing the current query.

## IPC files — agent-to-gateway (output) — shipped

The agent writes `.json` files to `/workspace/ipc/messages/` and
`/workspace/ipc/tasks/`. The gateway watches these directories via
`fs.watch` + fallback poll.

### Message file

```json
{ "type": "message", "chatJid": "tg:-100123456", "text": "response text" }
```

### File attachment

```json
{
  "type": "file",
  "chatJid": "tg:-100123456",
  "filepath": "/workspace/group/out.pdf",
  "filename": "report.pdf"
}
```

`filepath` must be under `/workspace/group/` — the gateway enforces this.

### Task file (in `/workspace/ipc/tasks/`)

```json
{
  "type": "schedule_task",
  "targetJid": "tg:-100123456",
  "prompt": "…",
  "schedule_type": "cron",
  "schedule_value": "0 9 * * 1",
  "context_mode": "isolated"
}
```

Other task types: `pause_task`, `resume_task`, `cancel_task`,
`refresh_groups`, `register_group`.

## System context injection — shipped

The agent SDK receives character context and (for non-main groups) a global
`CLAUDE.md` via `systemPrompt.append`:

- `/app/character.json` (default) merged with `/workspace/global/character.json`
  (instance override) — ElizaOS-style: `bio`, `topics`, `adjectives`
  randomised per query; `system` injected verbatim.
- `/workspace/global/CLAUDE.md` appended for non-main groups only.

Group-specific CLAUDE.md lives in `/home/node/.claude/CLAUDE.md` and is
loaded by the SDK's standard project-memory mechanism.

## Open items

### reply_to threading — open

`reply_to` attribute on `<message>` is described in `specs/v1/channels.md`
but is not yet emitted by `formatMessages()`. The field exists on `NewMessage`
in the DB schema but `formatMessages()` in `src/router.ts` does not include
it.

### XML throughout — closed, won't do

XML for prompt content Claude reads (`<messages>`, `<system>`). JSON
for everything the SDK/machine touches: stdin envelope, stdout envelope,
IPC files, tool calls. The SDK speaks JSON natively — wrapping it in
XML adds complexity for no gain. See `specs/xml-vs-json-llm.md`.
