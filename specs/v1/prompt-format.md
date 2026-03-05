# Prompt format — open

## Problem

Message history is injected into the agent prompt as XML, while everything
else in the pipeline is JSON. The XML island requires `escapeXml()`, is
inconsistent with the stdin payload and IPC formats, and is harder for the
agent to reference programmatically.

## Current state

`router.ts:formatMessages()` produces:

```xml
<messages>
  <message sender="Alice" time="2026-03-05T10:00:00Z">hey can you help</message>
  <message sender="Bob" time="2026-03-05T10:00:01Z">sure what do you need</message>
</messages>
```

This string is assigned to `input.prompt` and written to container stdin as
part of the JSON payload. The rest of the pipeline is already JSON:

| Part                      | Format             |
| ------------------------- | ------------------ |
| stdin payload             | JSON               |
| IPC message files         | JSON               |
| agent output              | JSON               |
| message history in prompt | XML ← inconsistent |

## Proposed

Replace `formatMessages()` with a JSON equivalent. The `prompt` field becomes
a JSON string (or the messages array moves to a dedicated field on the input
object — see below).

### Option A — messages as a top-level field

```typescript
interface ContainerInput {
  prompt: string; // triggering message text only
  messages: Message[]; // full history as structured array
  // ...rest of input
}

interface Message {
  sender: string;
  sender_name?: string;
  time: string;
  content: string;
  replyTo?: string; // thread handle, if present
}
```

Agent receives the history as a proper array, can index into it, reference
`replyTo`, etc. `prompt` carries only the trigger text.

### Option B — JSON string in prompt

Keep `prompt` as a single string but serialize to JSON instead of XML:

```json
{
  "messages": [
    { "sender": "Alice", "time": "...", "content": "hey can you help" },
    { "sender": "Bob", "time": "...", "content": "sure what do you need" }
  ]
}
```

Simpler change but loses the structural separation between history and trigger.

**Option A is preferred** — cleaner contract, enables `replyTo` threading,
removes the XML escaping requirement entirely.

## Changes

- `src/router.ts` — replace `formatMessages()` + `escapeXml()` with a
  `serializeMessages()` that returns `Message[]`
- `src/container-runner.ts` — add `messages: Message[]` to `ContainerInput`,
  update stdin write
- `src/index.ts` — update call sites that set `input.prompt`
- `container/CLAUDE.md` — update agent context docs to reflect JSON format
- `escapeXml()` and `stripInternalTags()` can be removed if no other XML remains

## Notes

`replyTo` on `Message` is the natural place to carry thread context through
to the agent (see `specs/v1/channels.md`). Adding it here is zero extra cost.
