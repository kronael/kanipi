---
status: open
---

# Dashboard: Status & Health

First concrete dashboard. Read-only operator view of gateway
health, active containers, message queues, and recent activity.

## What it shows

| Section           | Data source                                |
| ----------------- | ------------------------------------------ |
| Uptime            | `process.uptime()`, `process.memoryUsage`  |
| Channels          | `channels[]` — name, connected, type       |
| Groups            | DB groups — name, folder, tier, session    |
| Active containers | `GroupQueue.getActiveJids()` + docker ps   |
| Queue state       | Per-group: pending messages, pending tasks |
| Recent log        | Last 50 info/error entries (ring buffer)   |

## API

```
GET /dash/status/            → static HTML (status.html)
GET /dash/status/api/state   → JSON snapshot
GET /dash/status/api/stream  → SSE for live updates
```

### `GET /api/state`

```json
{
  "uptime": 86400,
  "memory_mb": 128,
  "channels": [
    { "name": "telegram", "connected": true },
    { "name": "whatsapp", "connected": true }
  ],
  "groups": [
    {
      "name": "root",
      "folder": "root",
      "tier": 0,
      "active": true,
      "pending_messages": false,
      "pending_tasks": 0
    }
  ],
  "containers": [
    {
      "name": "nanoclaw-root-abc",
      "status": "running",
      "uptime": "5m",
      "group": "root"
    }
  ]
}
```

### `GET /api/stream`

SSE events:

| Event             | Payload                        |
| ----------------- | ------------------------------ |
| `container:start` | `{ group, container, reason }` |
| `container:stop`  | `{ group, container, dur_ms }` |
| `queue:enqueue`   | `{ group, type }`              |
| `error`           | `{ group, message }`           |

Clients reconnect via standard EventSource retry.

## Implementation

### Gateway state exposure

GroupQueue needs a read accessor for dashboard:

```typescript
getStatus(): { activeCount: number; groups: GroupStatusEntry[] }
```

Where `GroupStatusEntry` has: jid, active, pendingMessages,
pendingTasks count, containerName.

### Container list

`docker ps --filter ancestor=<image> --format json`, cached 5s.
Parsed and returned as array. Uses existing `CONTAINER_IMAGE` config.

### Log ring buffer

Small in-memory ring buffer (capacity 50) that captures recent
log entries at info+ level. Pino destination that tees to the
buffer alongside stdout. Dashboard reads from buffer, no file
parsing.

```typescript
const LOG_BUFFER: LogEntry[] = [];
const LOG_BUFFER_SIZE = 50;

export function pushLog(entry: LogEntry): void {
  LOG_BUFFER.push(entry);
  if (LOG_BUFFER.length > LOG_BUFFER_SIZE) LOG_BUFFER.shift();
}
```

### Frontend

Single `status.html`. Fetches `/api/state` on load, re-fetches
every 10s. Subscribes to `/api/stream` for real-time events.
Table layout, no framework. Color coding: green (ok), yellow
(idle >5min), red (error/circuit breaker).

## Dependencies

- Dashboard portal system (4/4-dashboards.md)
- Auth middleware (existing)
- GroupQueue state accessor (new method)
- Docker ps parsing (new utility)

## Not in scope

- Mutations (kill, restart, clear)
- Historical metrics or graphs
- Per-message inspection
