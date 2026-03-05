# Prompt format — open

## Problem

The pipeline is inconsistently formatted. Message history is XML but the
stdin payload, IPC files, and agent output are all JSON. XML should be used
throughout — it is already what the agent sees for message history, it is
Claude's native format for structured context, and it eliminates the
JSON/XML impedance mismatch.

## Current state

| Part                      | Format |
| ------------------------- | ------ |
| stdin payload             | JSON   |
| IPC message files         | JSON   |
| agent output              | JSON   |
| message history in prompt | XML    |

## Proposed: XML throughout

### stdin payload

Replace `JSON.stringify(input)` with an XML envelope:

```xml
<input>
  <chat_jid>tg:-100123456</chat_jid>
  <is_main>1</is_main>
  <messages>
    <message sender="Alice" time="2026-03-05T10:00:00Z" reply_to="12345">
      hey can you help
    </message>
    <message sender="Bob" time="2026-03-05T10:00:01Z">
      sure what do you need
    </message>
  </messages>
</input>
```

`reply_to` on a `<message>` carries the channel-native thread handle
(see `specs/v1/channels.md`).

### Agent output

Replace JSON response object with XML:

```xml
<output>
  <message chat_jid="tg:-100123456" reply_to="12345">response text here</message>
</output>
```

`reply_to` on `<message>` is optional — agent includes it when responding
in a thread.

### IPC files

Replace JSON IPC message files with XML:

```xml
<ipc type="message" chat_jid="tg:-100123456">text here</ipc>
<ipc type="file" chat_jid="tg:-100123456" filepath="/workspace/group/out.pdf" />
<ipc type="task" action="schedule" ... />
```

## Changes

- `src/container-runner.ts` — serialize `ContainerInput` to XML for stdin
- `src/router.ts` — `formatMessages()` already XML; extend to full envelope;
  remove `escapeXml()` duplication (keep one shared util)
- `src/index.ts` — parse agent XML output instead of JSON
- `src/ipc.ts` — read/write XML IPC files instead of JSON
- `container/agent-runner/` — update agent-side IPC read/write to XML
- `container/CLAUDE.md` — update agent context docs

## Notes

`escapeXml()` stays — required whenever user content is embedded in XML.
`stripInternalTags()` stays — agents use `<internal>` for scratchpad content
that should not be sent to users.
