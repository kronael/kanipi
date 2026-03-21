---
status: shipped
---

# Dashboard: Messages & Activity

Operator view of message flow through the gateway. Shows recent
activity per group, which chats are active, message volume, and
the routing path messages take.

## Screen

Monospace font, max-width 900px, centered. Back link to portal.
H1: "Messages & Activity".

### 1. Activity Summary

Counts for last 24h: total messages, unique chats, unique senders,
messages per channel.

```
24h: 156 messages | 12 chats | 8 senders | tg: 89 wa: 52 dc: 15
```

### 2. Recent Messages

Table of last 50 messages across all groups. Columns: time (ago
format), channel icon/abbrev, chat, sender, group, first 80 chars
of text.

- Messages are display-only -- no content editing
- Truncated text, no expand (privacy: operators see enough to
  diagnose, not enough to read conversations)
- Auto-refresh every 10s

### 3. Active Chats

Table of chats with recent activity (last 24h). Columns: JID,
channel, group, message count (24h), last message time, sender
count.

Sorted by last message time descending. Clickable -> filters
Recent Messages to that chat.

### 4. Message Flow

Per-group message volume bar chart (text-based, not graphical).
Shows messages per group in the last 24h as horizontal bars
using Unicode block characters.

```
root      ████████████████████████  89
support   ████████████              42
dev       ████████                  25
```

### 5. Routing Table

Read-only view of the routes table. Columns: JID, sequence, type,
match pattern, target folder.

Grouped by JID. Shows which messages go where. Template targets
(containing `{sender}`) marked with a badge.

## Health Function

```typescript
health(ctx): { status, summary }
// ok: messages flowing (any message in last 1h)
// warn: no messages in last 1h (might be quiet or might be broken)
// error: no messages in last 24h
```

Summary: `"156 messages (24h), 12 active chats"`.

## Stories

1. Operator opens `/dash/activity/` -> sees summary bar with 24h counts
2. Recent messages table shows latest messages with truncated text
3. Operator clicks active chat -> recent messages filters to that chat
4. Message flow shows which groups are busiest
5. Routing table shows where messages get routed
6. Template routes marked distinctly (auto-threading indicator)
7. Activity summary breaks down by channel
8. No messages in 1h -> health turns yellow on portal tile
9. Recent messages auto-refresh every 10s
10. Operator checks routing for a JID -> finds it in routing table

## HTMX Fragments

```
GET /dash/activity/x/summary              -> 24h summary bar (30s refresh)
GET /dash/activity/x/recent?chat=<jid>    -> recent messages table (10s refresh)
GET /dash/activity/x/chats                -> active chats table (30s refresh)
GET /dash/activity/x/flow                 -> message flow bars (60s refresh)
GET /dash/activity/x/routes               -> routing table (60s refresh)
```

## API

```
GET /dash/activity/api/summary            -> 24h activity counts
GET /dash/activity/api/recent?limit=50&chat=<jid>  -> recent messages
GET /dash/activity/api/chats              -> active chats with counts
GET /dash/activity/api/routes             -> full routing table
```

### `GET /api/summary`

```json
{
  "period_hours": 24,
  "total_messages": 156,
  "unique_chats": 12,
  "unique_senders": 8,
  "by_channel": { "telegram": 89, "whatsapp": 52, "discord": 15 },
  "by_group": { "root": 89, "support": 42, "dev": 25 }
}
```

### `GET /api/recent`

```json
[
  {
    "id": 4521,
    "timestamp": "2026-03-17T10:34:00Z",
    "ago": "2m",
    "channel": "telegram",
    "chat_jid": "tg:123456",
    "sender": "alice",
    "group": "root",
    "text_preview": "can you check the deployment status for..."
  }
]
```

## DashboardContext Dependencies

- `getMessagesSince(jid, since, prefix)` -- recent messages
  (need variant: `getRecentMessages(limit)` across all JIDs)
- `getAllChats()` -- chat list with metadata
- `getAllRoutes()` -- routing table
- `getAllGroupConfigs()` -- group names for flow chart
- Message count queries (new: `getMessageCount(since)` per chat/group)

## Privacy

Message text is truncated to 80 characters in all views. No way
to view full message content from the dashboard. This is a
diagnostic tool, not a message reader. Operators see enough to
identify routing issues and volume patterns.

## Not in Scope

- Full message content viewing
- Message search (use channel apps for that)
- Real-time streaming (SSE)
- Message deletion or moderation
- Per-sender analytics
