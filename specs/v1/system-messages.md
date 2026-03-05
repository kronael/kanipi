# System Messages

System messages are gateway-generated annotations that ride alongside user
messages into the agent's stdin. They are never sent directly to the channel
and never trigger the agent alone — they piggyback on the next real user
message.

## Concept

Agent stdin is an **envelope**: zero or more system messages followed by the
user message. The agent receives full context about what the gateway did or
observed before that turn.

```xml
<system origin="command:/new">user invoked /new — session reset intentionally</system>
<system origin="diary">last session: 2026-03-04 — "discussed API design and auth flow"</system>
hey what's up
```

The user message follows the system block as plain text, matching what the
user actually typed.

## Queue

Gateway maintains a `pendingSystemMessages: SystemMessage[]` per group.

```ts
interface SystemMessage {
  origin: string; // who produced it — see Origins below
  body: string; // free text; agent-readable annotation
}
```

**Enqueue**: any gateway subsystem calls `enqueueSystemMessage(groupId, msg)`.

**Flush**: on each inbound user message, gateway:

1. Drains the queue for that group
2. Serialises as `<system origin="…">…</system>` lines
3. Prepends to stdin before the user message
4. Clears queue

If the queue is empty, stdin is just the user message — no overhead.

## Origins

| Origin                  | Producer               | When                                 |
| ----------------------- | ---------------------- | ------------------------------------ |
| `command:/new`          | `/new` command handler | User resets session                  |
| `command:<name>`        | any command handler    | Command sets context                 |
| `gateway:session-reset` | message loop           | Idle timeout session drop            |
| `gateway:new-day`       | message loop           | First message of a new calendar day  |
| `diary`                 | diary layer            | Session start — last session pointer |
| `episode`               | episode layer (v2)     | Periodic summary injection           |
| `fact`                  | facts layer (v2)       | Proactive fact retrieval result      |

Origin format: `<subsystem>` or `<subsystem>:<detail>`. Free-form but
consistent — the agent uses it to understand provenance.

## Agent awareness

The agent should know:

- System messages exist and what each origin means
- They are injected by the gateway, not by the user
- They carry factual state (session reset, time boundary, memory refs)
- They may arrive zero or many per turn

This is documented in the agent's self-persona skill (`container/skills/self/`)
so it can interpret and act on system messages without being confused by them.
The agent should never quote system messages back to the user verbatim.

## Format

XML chosen because system messages appear inline in a prompt context where
agents parse XML reliably (see `specs/xml-vs-json-llm.md`). The `origin`
attribute gives the agent structured provenance without needing a wrapper
schema.

Empty body is allowed (origin-only signal with no annotation text).

## Sources that do NOT produce system messages

- `/ping`, `/chatid` — command replies only, no agent involvement
- Channel join/leave events — gateway-internal, not surfaced to agent

## Open

- `enqueueSystemMessage` API location (`src/system-messages.ts` or inline
  in each subsystem — decide at implementation)
- Persistence: queue is in-memory; if gateway restarts between command and
  next user message, queued messages are lost. Accept for v1.
- Max queue depth: no limit for v1; revisit if abuse seen
- Agent self-persona update (add system message section to
  `container/skills/self/SKILL.md`)
