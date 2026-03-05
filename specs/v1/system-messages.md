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
<system origin="gateway" event="new-session">
  <previous_session id="9123f10a" started="2026-03-04T08:12Z" ended="2026-03-04T14:33Z" msgs="42" result="ok"/>
  <previous_session id="fa649547" started="2026-03-03T10:00Z" ended="2026-03-03T10:05Z" msgs="3" result="error" error="container exited 1"/>
  <previous_session id="3c8a12bb" started="2026-03-01T09:00Z" ended="2026-03-01T09:45Z" msgs="18" result="ok"/>
</system>
<system origin="command" event="new">user invoked /new</system>
<system origin="diary" date="2026-03-04">deployed hel1v5, auth flow open</system>
hey what's up
```

The user message follows the system block as plain text.

## Schema

```xml
<system origin="<subsystem>" [event="<event>"] [<attr>="<value>" ...]>
  [child elements or body text]
</system>
```

- `origin` — subsystem (`gateway`, `command`, `diary`, `episode`, `fact`,
  `identity`)
- `event` — optional event name within the subsystem
- additional attributes optional and per-origin
- body — free-form text or typed child elements; may be empty

Child elements are used when the message carries a list of structured records
(e.g. `<previous_session>`). Plain body text for simple annotations.

## Queue

Gateway maintains a system message queue per group, stored in DB.

```ts
interface SystemMessage {
  origin: string; // subsystem
  event?: string; // optional event name
  attrs?: Record<string, string>; // optional extra attributes on <system>
  body: string; // serialised body (child elements or plain text)
}
```

**Enqueue**: any gateway subsystem calls `enqueueSystemMessage(groupId, msg)`.

**Flush**: in `processGroupMessages`, before building the prompt:

1. `SELECT * FROM system_messages WHERE group_id = ? ORDER BY id`
2. Serialise each as `<system origin="…" [event="…"] [attrs…]>body</system>`
3. Prepend block to stdin before the user message
4. `DELETE FROM system_messages WHERE group_id = ?` (in same transaction)

If the queue is empty, stdin is just the user message — no overhead.

## Origins

| Origin     | Event         | Child/attrs                            | Producer            | When                                |
| ---------- | ------------- | -------------------------------------- | ------------------- | ----------------------------------- |
| `gateway`  | `new-session` | `<previous_session>` records (last 10) | message loop        | Each new container spawn            |
| `gateway`  | `new-day`     | —                                      | message loop        | First message of a new calendar day |
| `command`  | `new`         | —                                      | `/new` handler      | User resets session                 |
| `command`  | `<name>`      | —                                      | any command handler | Command sets context                |
| `diary`    | —             | `date` attr                            | diary layer         | Session start — last diary pointer  |
| `episode`  | —             | —                                      | episode layer (v2)  | Periodic episode summary injection  |
| `fact`     | —             | `<fact>` records (v2)                  | facts layer (v2)    | Proactive fact retrieval result     |
| `identity` | —             | —                                      | identity layer (v2) | Active identity context             |

### `<previous_session>` attributes

| Attr      | Type    | Description                              |
| --------- | ------- | ---------------------------------------- |
| `id`      | string  | session UUID (agent can read `.jl` file) |
| `started` | ISO8601 | container spawn time                     |
| `ended`   | ISO8601 | container exit time (omit if unknown)    |
| `msgs`    | int     | messages processed in session            |
| `result`  | string  | `ok` \| `error` \| `unknown`             |
| `error`   | string  | error text if `result="error"`           |

## Sessions table

Gateway records every session in DB. Written on spawn, updated on exit.

```sql
CREATE TABLE sessions (
  session_id    TEXT PRIMARY KEY,
  group_id      TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  message_count INTEGER,
  result        TEXT,   -- 'ok' | 'error' | 'unknown'
  error         TEXT    -- populated if result='error'
);
```

On new-session injection: `SELECT * FROM sessions WHERE group_id = ? ORDER BY started_at DESC LIMIT 10`.

## Persistence

System messages are stored in DB — loss on gateway restart is not acceptable.

```sql
CREATE TABLE system_messages (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  origin   TEXT NOT NULL,
  event    TEXT,
  attrs    TEXT,  -- JSON object of extra attributes
  body     TEXT NOT NULL,
  ts       TEXT NOT NULL
);
```

## Agent awareness

The agent should know:

- System messages exist and what each origin means
- They are injected by the gateway, not by the user
- `gateway.new-session` gives session history — use `id` to look up `.jl` if
  needed for deeper continuity
- They may arrive zero or many per turn
- Never quote system messages back to the user verbatim

Documented in `container/skills/self/SKILL.md` so the agent interprets them
correctly.

## Sources that do NOT produce system messages

- `/ping`, `/chatid` — command replies only, no agent involvement
- Channel join/leave events — gateway-internal, not surfaced to agent

## Open

- `enqueueSystemMessage` / `flushSystemMessages` in `src/db.ts`
- `sessions` table: write on spawn, update on exit in `container-runner.ts`
- `new-session` injection: query sessions table, build `<previous_session>`
  block, enqueue before each container spawn
- Agent self-persona update: add system messages section to
  `container/skills/self/SKILL.md`
- Max queue depth: no limit for v1; revisit if abuse seen
