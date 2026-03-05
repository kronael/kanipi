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
<system origin="gateway" event="session-reset" prev="9123f10a fa649547 3c8a12bb">session reset</system>
<system origin="command" event="new">user invoked /new</system>
<system origin="diary" date="2026-03-04">deployed hel1v5, auth flow open</system>
hey what's up
```

The user message follows the system block as plain text, matching what the
user actually typed.

## Schema

```xml
<system origin="<subsystem>" [event="<event>"] [<attr>="<value>" ...]>body</system>
```

- `origin` — subsystem that produced the message (`gateway`, `command`,
  `diary`, `episode`, `fact`)
- `event` — optional, names the specific event within the subsystem
- additional attributes are optional and per-origin (see Origins table)
- body — free-form human-readable note for the agent; may be empty

## Queue

Gateway maintains a `pendingSystemMessages: SystemMessage[]` per group.

```ts
interface SystemMessage {
  origin: string; // subsystem
  event?: string; // optional event name
  attrs?: Record<string, string>; // optional extra attributes
  body: string; // free text
}
```

**Enqueue**: any gateway subsystem calls `enqueueSystemMessage(groupId, msg)`.

**Flush**: on each inbound user message, gateway:

1. Drains the queue for that group
2. Serialises as `<system ...>…</system>` lines
3. Prepends to stdin before the user message
4. Clears queue

If the queue is empty, stdin is just the user message — no overhead.

## Origins

| Origin    | Event           | Extra attrs            | Producer               | When                                |
| --------- | --------------- | ---------------------- | ---------------------- | ----------------------------------- |
| `gateway` | `session-reset` | `prev` (space-sep IDs) | message loop           | Idle timeout or stale ID recovery   |
| `gateway` | `new-day`       | —                      | message loop           | First message of a new calendar day |
| `command` | `new`           | —                      | `/new` command handler | User resets session                 |
| `command` | `<name>`        | —                      | any command handler    | Command sets context                |
| `diary`   | —               | `date`                 | diary layer            | Session start — last diary pointer  |
| `episode` | —               | —                      | episode layer (v2)     | Periodic summary injection          |
| `fact`    | —               | —                      | facts layer (v2)       | Proactive fact retrieval            |

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

## Persistence

System messages are stored in the DB, not in-memory. Loss on gateway
restart is not acceptable.

```sql
CREATE TABLE system_messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  origin   TEXT NOT NULL,
  body     TEXT NOT NULL,
  ts       TEXT NOT NULL
);
```

**Enqueue**: `INSERT INTO system_messages`.

**Flush**: in `processGroupMessages`, before building the prompt:

1. `SELECT * FROM system_messages WHERE group_id = ? ORDER BY id`
2. Serialise as `<system origin="…">…</system>` lines, prepend to stdin
3. `DELETE FROM system_messages WHERE group_id = ?`

Steps 1–3 run in a transaction — atomic flush, no partial loss.

## Open

- `enqueueSystemMessage` / `flushSystemMessages` in `src/db.ts` alongside
  other DB helpers
- Max queue depth: no limit for v1; revisit if abuse seen
- Agent self-persona update (add system message section to
  `container/skills/self/SKILL.md`)
