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
On each invocation, `getMessagesSince(chatJid, lastAgentTimestamp)` fetches
messages since the last agent run.

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

The agent has two sources of history:

- **Gateway pipe** — messages from DB, sliding window (this spec)
- **SDK session** — full prior turns replayed from `.jl` transcript on
  container restart (`resume: sessionId`)

These overlap on session resume. On new session after reset, SDK session is
empty but DB still has messages — agent sees what was said but not how it
responded. The `gateway.new-session` system message with `<previous_session>`
records helps orient the agent in this case.

No deduplication between sources — agent reconciles.

## Open

- **`reply_to` not emitted** — not yet populated by channels or included in
  `formatMessages()` (see `specs/v1/channels.md`)
- **No compaction** — `messages` table grows forever; no TTL, no row cap
- **`get_history` IPC** — agent cannot query further back on demand
- **Contradictory context** — session/DB overlap unresolved; may need flag
  to suppress DB history when SDK session is live and covers the same period
