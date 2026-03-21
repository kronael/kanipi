---
status: shipped
---

# Audit Log

Record every outbound message the gateway sends to any channel.
Covers agent replies, IPC actions (send_message, send_reply,
send_file), scheduled task output, and future control chat
notifications. Uses the existing `messages` table with
`is_from_me=1, is_bot_message=1` — same data structure, different
queue (existing queries filter `is_bot_message=0`).

## Schema

Migration `0012-outbound-log.sql` adds columns to `messages`:

```sql
ALTER TABLE messages ADD COLUMN source TEXT;
ALTER TABLE messages ADD COLUMN group_folder TEXT;
```

`source` values: `agent`, `ipc`, `scheduler`, `control`, `error`.

## API

```typescript
// src/db.ts
function storeOutbound(entry: {
  chatJid: string;
  content: string;
  source: string;
  groupFolder?: string;
  replyToId?: string;
  platformMsgId?: string;
}): void;
```

Non-blocking: wraps INSERT in try/catch, warns on failure, never
throws. ID prefixed `out-` to avoid PK collision with inbound.

## Integration points

| Source    | File:line           | What                     |
| --------- | ------------------- | ------------------------ |
| agent     | `src/index.ts:450`  | streaming agent output   |
| agent     | `src/index.ts:615`  | delegate/escalate output |
| ipc       | `src/index.ts:1276` | IPC sendMessage dep      |
| ipc       | `src/index.ts:1296` | IPC sendDocument dep     |
| scheduler | `src/index.ts:1261` | scheduler sendMessage    |

## Queries

```sql
-- Full conversation history (inbound + outbound)
SELECT * FROM messages WHERE chat_jid = ? ORDER BY timestamp;

-- Outbound only
SELECT * FROM messages
WHERE chat_jid = ? AND is_from_me = 1 ORDER BY timestamp;

-- Outbound by source
SELECT * FROM messages
WHERE source = 'agent' AND timestamp > datetime('now', '-1 day');
```

## Not in scope

- File archiving (saving sent files to a permanent store)
- Message delivery confirmation
- Content redaction or retention policies
- Gateway command responses (/ping, /stop — operational noise)
