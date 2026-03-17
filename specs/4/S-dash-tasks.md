---
status: spec
---

# Dashboard: Tasks

Operator view of scheduled tasks -- what's running, what failed,
run history. The status dashboard shows tasks exist; this dashboard
lets you understand them.

## Screen

Monospace font, max-width 900px, centered. Back link to portal.
H1: "Tasks".

### 1. Summary Bar

Counts: total tasks, active, paused, failed (last 24h).

```
12 tasks | 10 active | 1 paused | 1 failed (24h)
```

### 2. Task List

Table: ID, group, schedule (human-readable), next run, status,
last run result, last run time.

- Schedule column: cron expression + human gloss
  (`0 9 * * *` -> "daily 9:00")
- Status column: active (green), paused (grey), colored by state
- Last run: ok (green), error (red), never (grey)
- Clickable rows -> expand to show run history

### 3. Task Detail (expanded row)

When a task row is clicked, expands inline via HTMX to show:

- Full task config: prompt, command, context_mode, chat_jid
- Run history table (last 20 runs): timestamp, duration, status,
  result/error (truncated, expandable)
- Cron schedule visualized: next 5 upcoming run times

### 4. Filter Controls

- Group filter dropdown (all groups / specific group)
- Status filter: all / active / paused / failed

Filters via HTMX query params, no page reload.

## Health Function

```typescript
health(ctx): { status, summary }
// ok: no failed runs in last 24h
// warn: 1+ failed runs in last 24h
// error: 3+ consecutive failures on any task
```

Summary: `"8 active, 0 failed"` or `"8 active, 2 failed (24h)"`.

## Stories

1. Operator opens `/dash/tasks/` -> sees summary bar and task list
2. Task with recent failure -> last run column shows red "error"
3. Operator clicks failed task -> expands to show run history with error details
4. Operator filters by group -> task list shows only that group's tasks
5. Cron expression shown with human-readable gloss
6. Next run time shown for each active task
7. Paused tasks shown in grey
8. Run history shows duration -- helps identify slow tasks
9. Operator sees task prompt text in detail view
10. Auto-refresh updates task status and last run every 10s

## HTMX Fragments

```
GET /dash/tasks/x/summary                  -> summary bar (10s refresh)
GET /dash/tasks/x/list?group=<f>&status=<s> -> task list table (10s refresh)
GET /dash/tasks/x/detail?id=<id>           -> expanded task detail
GET /dash/tasks/x/runs?id=<id>             -> run history for task
```

## API

```
GET /dash/tasks/api/tasks                  -> all tasks JSON
GET /dash/tasks/api/tasks/:id              -> single task + recent runs
GET /dash/tasks/api/runs?task_id=<id>&limit=20  -> run history
```

### `GET /api/tasks`

```json
[
  {
    "id": "daily-digest",
    "group_folder": "root",
    "chat_jid": "tg:123456",
    "schedule": "0 9 * * *",
    "schedule_human": "daily 9:00",
    "status": "active",
    "next_run": "2026-03-18T09:00:00Z",
    "last_run": {
      "at": "2026-03-17T09:00:00Z",
      "duration_ms": 45000,
      "status": "ok"
    }
  }
]
```

## DashboardContext Dependencies

- `getAllTasks()` -- task list
- `getTasksForGroup(folder)` -- filtered by group
- `task_run_logs` table -- run history (need new query: `getTaskRunLogs(taskId, limit)`)
- `getAllGroupConfigs()` -- group names for filter dropdown
- Cron next-run calculation (`cron-parser`)

## Not in Scope

- Task creation/editing (use CLI or agent)
- Task pause/resume from dashboard (mutation)
- Real-time task output streaming
