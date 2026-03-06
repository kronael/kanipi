# Memory: Messages

Recent message history piped into the agent on each invocation.
Part of the stdin envelope alongside system messages.

## Stdin envelope — full picture

The agent receives a single `prompt` string in `ContainerInput`. It is an
envelope with two sections, in order:

```xml
<system origin="gateway" event="new-session">
  <previous_session id="9123f10a" started="2026-03-04T08:12Z" ended="2026-03-04T14:33Z" msgs="42" result="ok"/>
</system>
<system origin="diary" date="2026-03-04">deployed hel1v5, auth flow open</system>
<messages>
  <message sender="Alice" time="2026-03-05T10:00:00Z">hey</message>
  <message sender="Bob" time="2026-03-05T10:00:01Z">sure, what do you need</message>
</messages>
```

1. **System messages** — zero or more `<system>` blocks flushed from the
   gateway queue (see `specs/v1/system-messages.md`). Orientation, session
   history, diary pointer, command annotations. Empty if nothing queued.
2. **Message history** — `<messages>` block, always present. Sliding window
   of recent channel messages since last agent run.

The agent reads top to bottom: orient first, then act on messages.

## Message history — shipped

`formatMessages()` in `src/router.ts` produces the `<messages>` block.
Gateway stores every inbound message in the `messages` table (SQLite).
On each invocation, query fetches at most **30 messages from the last 2 days**.
If older messages exist, a comment is included:

```xml
<messages>
  <!-- 47 older messages not shown — use get_history to retrieve -->
  <message sender="Alice" time="2026-03-05T10:00:00Z">hey can you help</message>
  ...
</messages>
```

This limit will be expanded as memory layers improve.

```xml
<messages>
  <message sender="Alice" time="2026-03-05T10:00:00Z">hey can you help</message>
  <message sender="Bob" time="2026-03-05T10:00:01Z">sure</message>
</messages>
```

Attributes:

- `sender` — display name if known; falls back to raw sender ID
- `time` — ISO 8601 from DB record
- `reply_to` — channel-native reply handle; omitted if not a reply (open)
- Content — XML-escaped user text

Bot messages filtered out (`is_bot_message = 0`).

## Session interaction

Two sources of history exist:

- **Gateway pipe** — messages from DB, sliding window (this spec)
- **SDK session** — full prior turns replayed from `.jl` transcript

**Rule**: `<messages>` is only injected on **new session**. On session resume
the SDK transcript already has full context — injecting DB messages would
duplicate and potentially contradict it. Pending system messages are always
flushed regardless.

Envelope on new session:

```xml
<system origin="gateway" event="new-session">...</system>
<system origin="diary" date="2026-03-04">...</system>
<messages>...</messages>
```

Envelope on resume:

```xml
<!-- system messages only if queued, otherwise empty -->
hey what's up
```

Gateway determines new vs resume by whether a stored `session_id` exists for
the group before the spawn.

## Open

- **`reply_to` not emitted** — not yet populated by channels or included in
  `formatMessages()` (see `specs/v1/channels.md`)
- **No compaction** — `messages` table grows forever; no TTL, no row cap
- **`get_history` IPC** — agent cannot query further back on demand
