---
status: spec
---

# Dashboard: Status & Health

Operator view of gateway health, channels, containers, queues,
and recent errors. Primary diagnostic tool -- the first place an
operator looks when something seems wrong.

## Criticism of Current Design

The shipped v1 is a flat list of tables. Problems:

1. **No errors visible** -- failures are a number in the queue table.
   No error messages, no stack traces, no timestamps. An operator
   sees "failures: 2" but can't tell what happened.
2. **Tasks not explorable** -- task rows show ID/schedule/status but
   not run history, last result, or failure details.
3. **No historical data** -- everything is current-moment snapshot.
   No way to see if failures happened an hour ago or are ongoing.
4. **Monolithic refresh** -- all sections rebuild on every 10s poll.
   Wasteful when only queue state changes frequently.
5. **No drill-down** -- groups are listed but you can't click one
   to see its containers, queue, tasks. Everything is flat.
6. **Container names are opaque** -- shows docker names but not
   which group/JID they serve or how long they've been running.
7. **Version info missing** -- no gateway version, no agent image tag.

## Redesigned Screen

Monospace font, max-width 900px, centered. Back link to portal.
H1: "Status & Health". Sections in order:

### 1. Health Banner

Single row at top. Green/yellow/red background.

- Green: all channels connected, no failures, queue draining
- Yellow: >0 failures in queue, or container count at max
- Red: channel disconnected, or circuit breaker tripped

Shows: version, uptime, memory. One line.

```
v1.5.0 | up 2h 15m | 128 MB | 3 channels | 2/3 containers
```

### 2. Channels

Table: name, status (connected/disconnected), message count (24h).
Disconnected channels highlighted red.

### 3. Groups

Table: name, folder, tier, active (dot), container status, queue depth.
Clickable rows -- expand inline to show group detail (routes,
recent tasks, queue entries for that group).

### 4. Containers

Table: name, group, status, uptime, idle (yes/no).
Container names decoded to show group folder.

### 5. Queue

Table: JID, group folder, active, idle, pending msgs, pending tasks,
failures, circuit breaker state. Failures column red when >0.
Circuit breaker column shows "tripped" in red when applicable.

### 6. Recent Errors

New section. Shows last 20 errors from task_run_logs (status=error)
and queue failures. Each row: timestamp, group, source (task/queue),
error message (truncated). Expandable rows show full error text.

Auto-refresh every 5s (errors are the most time-sensitive section).

### 7. Summary

Chat count, task count, route count. Timestamp of last update.

## Health Function

```typescript
health(ctx): { status, summary }
// ok: 0 failures, all channels connected
// warn: >0 failures or container count == max
// error: channel disconnected or circuit breaker tripped
```

Summary format: `"3 channels, 2 containers, 0 errors"` or
`"1 channel down, 3 errors"`.

## Stories

1. Operator opens `/dash/status/` -> sees health banner (green), all sections
2. Channel goes down -> banner turns red, channel row highlighted
3. Task fails -> error appears in Recent Errors section within 5s
4. Operator clicks a group row -> expands to show routes, tasks, queue for that group
5. Queue failure count > 0 -> failures cell turns red
6. Circuit breaker trips -> queue row shows "tripped" in red
7. All containers at max -> banner turns yellow
8. Operator checks version -> visible in health banner
9. Error row clicked -> expands to show full error message
10. Operator navigates back to portal via back link

## HTMX Fragments

```
GET /dash/status/x/banner      -> health banner (5s refresh)
GET /dash/status/x/channels    -> channels table (30s refresh)
GET /dash/status/x/groups      -> groups table (10s refresh)
GET /dash/status/x/containers  -> containers table (10s refresh)
GET /dash/status/x/queue       -> queue table (5s refresh)
GET /dash/status/x/errors      -> recent errors (5s refresh)
GET /dash/status/x/summary     -> summary line (30s refresh)
GET /dash/status/x/group-detail?folder=<f>  -> expanded group detail
```

## API

```
GET /dash/status/api/state     -> full JSON snapshot
GET /dash/status/api/errors    -> recent errors JSON
```

### `GET /api/state`

Same as current but adds: `version`, `errors[]`, per-group
`tier` and `circuit_breaker` fields, channel `connected` boolean.

### `GET /api/errors`

```json
[
  {
    "timestamp": "2026-03-17T10:34:00Z",
    "group": "root",
    "source": "task",
    "task_id": "daily-digest",
    "error": "Container timeout with no output",
    "duration_ms": 300000
  }
]
```

## DashboardContext Dependencies

- `GroupQueue.getStatus()` -- queue state per JID
- `getAllGroupConfigs()` -- group list with tiers
- `getAllTasks()` -- task list
- `getAllChats()` -- chat count
- `docker ps` -- container list (cached 5s)
- `task_run_logs` table -- recent errors (new query needed)
- `process.uptime()`, `process.memoryUsage()` -- gateway stats
- Channel connected state (new: channels need a `connected` accessor)
- Package version from `package.json`

## Not in Scope

- Mutations (kill container, restart channel, clear queue)
- Historical metrics or time-series graphs
- Per-message inspection (see activity dashboard)
- SSE streaming
