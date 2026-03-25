# Scheduling

Tasks run agent prompts on a schedule. Use `schedule_task` MCP tool.

## schedule_task parameters

```
targetJid        string   # JID to send output to (usually $NANOCLAW_CHAT_JID)
targetFolder     string   # group folder to run as (usually $NANOCLAW_GROUP_FOLDER)
prompt           string   # what the agent should do
schedule_type    string   # cron | interval | once
schedule_value   string   # cron expr, ms count, or ISO timestamp
context_mode?    string   # isolated (default) | group
```

## Schedule types

| Type       | schedule_value           | Example                |
| ---------- | ------------------------ | ---------------------- |
| `cron`     | standard cron expression | `0 9 * * 1-5`          |
| `interval` | milliseconds             | `3600000` (1 hour)     |
| `once`     | ISO 8601 timestamp       | `2026-04-01T10:00:00Z` |

Cron timezone: `TIMEZONE` env var (default UTC). `cron-parser` library.

## Context modes

- **isolated** (default) — fresh session per run. No conversation history. Use for cron maintenance tasks.
- **group** — reuses the group's current session. Task sees prior conversation history. Use for tasks that should be aware of recent context.

## Managing tasks

```
schedule_task(...)      # create
pause_task(id)          # pause
resume_task(id)         # resume
cancel_task(id)         # delete
```

Task IDs are returned by `schedule_task`. Root can manage any task; non-root only own group's tasks.

## Examples

### Daily episodic memory compression

```javascript
schedule_task({
  targetJid: process.env.NANOCLAW_CHAT_JID,
  targetFolder: process.env.NANOCLAW_GROUP_FOLDER,
  prompt: '/compact-memories episodes day',
  schedule_type: 'cron',
  schedule_value: '0 2 * * *',
  context_mode: 'isolated',
});
```

### Weekly episode roll-up

```javascript
schedule_task({
  targetJid: process.env.NANOCLAW_CHAT_JID,
  targetFolder: process.env.NANOCLAW_GROUP_FOLDER,
  prompt: '/compact-memories episodes week',
  schedule_type: 'cron',
  schedule_value: '0 3 * * 1',
  context_mode: 'isolated',
});
```

### Daily morning research brief

```javascript
schedule_task({
  targetJid: process.env.NANOCLAW_CHAT_JID,
  targetFolder: process.env.NANOCLAW_GROUP_FOLDER,
  prompt: 'Research the latest news on <topic> and post a 3-bullet summary.',
  schedule_type: 'cron',
  schedule_value: '0 8 * * *',
  context_mode: 'isolated',
});
```

### One-time reminder

```javascript
schedule_task({
  targetJid: process.env.NANOCLAW_CHAT_JID,
  targetFolder: process.env.NANOCLAW_GROUP_FOLDER,
  prompt: 'Remind the user to review the quarterly report.',
  schedule_type: 'once',
  schedule_value: '2026-04-15T09:00:00Z',
});
```

## Standard memory compression tasks

These 5 tasks are seeded automatically when a new group is created via onboarding:

| Prompt                             | Cron        |
| ---------------------------------- | ----------- |
| `/compact-memories episodes day`   | `0 2 * * *` |
| `/compact-memories episodes week`  | `0 3 * * 1` |
| `/compact-memories episodes month` | `0 4 1 * *` |
| `/compact-memories diary week`     | `0 3 * * 1` |
| `/compact-memories diary month`    | `0 4 1 * *` |

All run with `context_mode: isolated`. Existing tasks are never overwritten by seeding.

## Behavior notes

- Tasks poll every 60s (`SCHEDULER_POLL_INTERVAL`)
- Tasks share the group queue — a task won't run while a user conversation is active
- Task output is sent to `targetJid` via `sendMessage`
- Failed tasks log to `task_run_logs`; invalid folder → task paused (stops retry churn)
- Single-turn: container closes 10s after result (not IDLE_TIMEOUT)
