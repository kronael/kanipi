---
status: shipped
---

# Dashboard: Status & Health

First concrete dashboard. Read-only operator view of gateway
health, active containers, message queues, and recent activity.
HTMX-based with fragment endpoints for partial updates.

## Screen

Monospace font, max-width 900px, centered. Back link
(`<- Dashboards`) to portal. H1: "Status & Health". Timestamp
showing last update time.

Sections in order, each an H2 with count in parens followed by
a table:

1. **Gateway** -- uptime (Xh Ym format), memory (MB), max concurrent
2. **Channels** -- connected channel names
3. **Groups** -- name, folder, active indicator (green=active)
4. **Containers** -- name, status, created time
5. **Queue** -- per-JID: active, idle, pending msgs, pending tasks,
   failures (red if >0)
6. **Tasks** -- ID, group, schedule, status
7. **Summary** -- chat count + timestamp

Tables: border-collapse, 1px solid #ccc borders, #f0f0f0 header
background. Color classes: `.ok` (green) for active states,
`.err` (red) for failures >0.

## What it shows

| Section    | Data source                               |
| ---------- | ----------------------------------------- |
| Gateway    | `process.uptime()`, `process.memoryUsage` |
| Channels   | `channels[]` -- name                      |
| Groups     | DB groups -- name, folder, active status  |
| Containers | `docker ps` filtered by CONTAINER_IMAGE   |
| Queue      | `GroupQueue.getStatus()` per-JID state    |
| Tasks      | DB tasks -- id, group, schedule, status   |
| Summary    | `getAllChats().length`                    |

## Stories

1. Operator opens `/dash/status/` -> sees status shell, HTMX loads
   all section fragments
2. Gateway section shows uptime, memory, max concurrent containers
3. Channels section shows connected channel names
4. Groups section shows all groups with name, folder, active status
   (green=active)
5. Containers section shows running containers with name, status,
   created time
6. Queue section shows per-JID queue state: active, idle, pending
   messages/tasks, failures (red if >0)
7. Tasks section shows scheduled tasks with ID, group, schedule, status
8. Chat count shown at bottom
9. Sections auto-refresh every 10s via HTMX polling
10. Operator navigates back to portal via back link

## API

```
GET /dash/status/              -> shell HTML (HTMX fragments load sections)
GET /dash/status/x/gateway     -> uptime, memory, max concurrent table
GET /dash/status/x/channels    -> channel list table
GET /dash/status/x/groups      -> groups table with active indicators
GET /dash/status/x/containers  -> running containers table
GET /dash/status/x/queue       -> queue state table
GET /dash/status/x/tasks       -> scheduled tasks table
GET /dash/status/x/summary     -> chat count + timestamp
GET /dash/status/api/state     -> JSON snapshot (programmatic use)
```

### Shell HTML

The shell loads HTMX from CDN and contains `div` elements with
`hx-get` and `hx-trigger="every 10s"` for each section:

```html
<script src="https://unpkg.com/htmx.org"></script>
<h2>Gateway</h2>
<div hx-get="/dash/status/x/gateway" hx-trigger="load, every 10s">
  Loading...
</div>
<h2>Channels</h2>
<div hx-get="/dash/status/x/channels" hx-trigger="load, every 10s">
  Loading...
</div>
...
```

### Fragment responses

Each `/x/<fragment>` endpoint returns a bare HTML partial (table
rows, paragraph) with no document wrapper. Example:

```html
<!-- GET /dash/status/x/gateway -->
<table>
  <tr>
    <th>Uptime</th>
    <td>2h 15m</td>
  </tr>
  <tr>
    <th>Memory</th>
    <td>128 MB</td>
  </tr>
  <tr>
    <th>Max concurrent</th>
    <td>3</td>
  </tr>
</table>
```

### `GET /api/state`

```json
{
  "uptime_s": 86400,
  "memory_mb": 128,
  "max_concurrent": 3,
  "channels": [{ "name": "telegram" }, { "name": "whatsapp" }],
  "groups": [{ "name": "root", "folder": "root", "active": true }],
  "containers": [
    {
      "name": "nanoclaw-root-abc",
      "status": "running",
      "created": "2026-03-16 10:00:00"
    }
  ],
  "queue": [
    {
      "jid": "root",
      "active": true,
      "idleWaiting": false,
      "pendingMessages": 0,
      "pendingTasks": 0,
      "failures": 0
    }
  ],
  "tasks": [
    {
      "id": 1,
      "group_folder": "root",
      "schedule": "0 9 * * *",
      "status": "active"
    }
  ],
  "chats": 42
}
```

## Implementation

### Handler routing

```typescript
function statusHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  ctx: DashboardContext,
): void {
  if (path === '/api/state') {
    serveJson(res, ctx);
    return;
  }
  if (path.startsWith('/x/')) {
    serveFragment(res, path.slice(3), ctx);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHELL_HTML);
}
```

### Container list

`docker ps --filter ancestor=<image> --format`, cached 5s.
Uses existing `CONTAINER_IMAGE` config.

### State builder

`buildState(ctx)` collects all sections into a single object.
Fragment endpoints call `buildState` and render only their section
to HTML. The `/api/state` endpoint returns the full object as JSON.

## Dependencies

- Dashboard portal system (4/4-dashboards.md)
- Auth middleware (existing)
- GroupQueue state accessor (`getStatus()`)
- Docker ps parsing (inline in dashboards/index.ts)

## Not in scope

- Mutations (kill, restart, clear)
- Historical metrics or graphs
- Per-message inspection
- SSE streaming (HTMX polling is sufficient)
