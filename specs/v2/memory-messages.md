# Memory: Messages — partial

Recent message history piped into the agent on each invocation.

## Current state

Gateway stores every inbound message in `messages` table (SQLite). On each
agent invocation, `getMessagesSince(chatJid, lastAgentTimestamp)` fetches
messages since the last agent run and pipes them as XML to container stdin:

```xml
<messages>
  <message sender="Alice" time="2026-03-05T10:00:00Z">hey</message>
</messages>
```

The agent sees a **sliding window** — only what arrived since its last run.
It cannot query further back. Bot messages are filtered out (`is_bot_message = 0`).

## Problems

**Session interaction**: the agent also has Claude Code's own session memory
(`resume: sessionId` in the SDK call). The session contains the full prior
conversation transcript. So history arrives via two channels:

- Gateway pipes: recent messages from DB (sliding window)
- SDK session: full prior turns within the same session (Claude Code internal)

These overlap and can contradict each other. If a new session starts (after
idle timeout or container restart), the SDK session resets but the gateway
DB still has messages. The agent then sees DB history without SDK context —
it knows what was said but not how it responded.

**No compaction**: `messages` table grows forever. No TTL, no row cap, no
archival. The sliding window naturally bounds what the agent sees per run,
but the DB itself is unbounded.

**No threading**: `replyTo` not stored or piped (see `specs/v1/channels.md`).

## Open

- Add `replyTo` to `NewMessage` and include in piped XML
- Define compaction policy (cap per chat, TTL, or summary+delete)
- Clarify session/DB history interaction — avoid contradictory context
- `get_history` IPC call so agent can query further back on demand
