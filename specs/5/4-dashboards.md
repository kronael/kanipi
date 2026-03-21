---
status: shipped
---

# Dashboard Portal

Tile-based operator portal for monitoring and inspecting gateway
state. Each subsystem has a dedicated dashboard; the portal shows
summary tiles with health indicators. HTMX-based, read-only.

## URL Convention

```
/dash/                       -> portal (tile grid)
/dash/<name>/                -> dashboard shell (loads HTMX fragments)
/dash/<name>/x/<fragment>    -> HTML fragment (partial)
/dash/<name>/api/<path>      -> JSON API (programmatic)
```

## Portal Design

`GET /dash/` renders a tile grid. Each registered dashboard gets a
tile showing: title, one-line status summary, and a health indicator
(green/yellow/red dot). Tiles link to the full dashboard.

### Tile health

Each dashboard optionally provides a `health()` function returning
`{ status: 'ok' | 'warn' | 'error', summary: string }`. The portal
calls all health functions on render. Dashboards without health
return neutral (grey dot).

### Layout

Max-width 900px, centered. Monospace font. 2-column grid of tiles,
each tile a bordered box with title (bold), status line, and dot.
Auto-refresh every 30s (slower than individual dashboards since
it's an overview).

```html
<div class="tiles">
  <a href="/dash/status/" class="tile">
    <span class="dot ok"></span>
    <strong>Status & Health</strong>
    <span>3 channels, 2 containers, 0 errors</span>
  </a>
  <a href="/dash/tasks/" class="tile">
    <span class="dot ok"></span>
    <strong>Tasks</strong>
    <span>8 active, 0 failed</span>
  </a>
  ...
</div>
```

## HTMX Pattern

Dashboards use HTMX (loaded from CDN: unpkg.com/htmx.org). The
shell page has `hx-get` attributes loading fragments from
`/dash/<name>/x/<fragment>`. Fragments return bare HTML with no
`<html>` wrapper. Auto-refresh via `hx-trigger="every Ns"`.

JSON API endpoints remain for scripting and monitoring.

## Dashboard Module

Each dashboard registers via `registerDashboard`:

```typescript
interface DashboardEntry {
  name: string;
  title: string;
  description: string;
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    ctx: DashboardContext,
  ) => void;
  health?: (ctx: DashboardContext) => {
    status: 'ok' | 'warn' | 'error';
    summary: string;
  };
}
```

## DashboardContext

Shared context passed to every handler. Extended from the original
to include DB access:

```typescript
interface DashboardContext {
  queue: GroupQueue;
  channels: Channel[];
  db: {
    getAllGroupConfigs: () => Record<string, GroupConfig>;
    getAllTasks: () => ScheduledTask[];
    getAllChats: () => ChatInfo[];
    getAllRoutes: () => Route[];
    getMessagesSince: (jid: string, since: string, prefix: string) => Message[];
  };
  groupsDir: string;
}
```

Dashboards are trusted gateway code -- they share the process and
DB. No sandboxing.

## Registration

```typescript
export function handleDashRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: DashboardContext,
): void {
  // /dash/ -> portal with tiles
  // /dash/<name>/* -> delegate to handler
}
```

## Concrete Dashboards

| Dashboard | Spec              | Route           | Description                          |
| --------- | ----------------- | --------------- | ------------------------------------ |
| status    | 4/P-dash-status   | /dash/status/   | Uptime, channels, containers, errors |
| tasks     | 4/S-dash-tasks    | /dash/tasks/    | Scheduled tasks, run history         |
| memory    | 4/Q-dash-memory   | /dash/memory/   | Knowledge stores, diary, episodes    |
| activity  | 4/T-dash-activity | /dash/activity/ | Message flow, recent activity        |
| groups    | 4/U-dash-groups   | /dash/groups/   | Group tree, routing, config          |

## Auth

All `/dash/*` routes require auth (JWT cookie). Same middleware
as web proxy (`checkAuth` in `web-proxy.ts`). See `specs/3/A-auth.md`.

## Frontend

HTMX from CDN, no build step. Each dashboard serves a shell page.
No shared frontend framework -- each dashboard is self-contained.
Common CSS variables for consistent look (monospace, borders, colors).

## File Layout

```
src/dashboards/
  index.ts          registration, portal handler, DashboardContext
  status.ts         status & health dashboard
  tasks.ts          tasks dashboard
  memory.ts         memory & knowledge dashboard
  activity.ts       messages & activity dashboard
  groups.ts         groups & routing dashboard
  html.ts           shared HTML helpers (esc, table builders, CSS)
```

## Stories

1. Operator opens `/dash/` -> sees tile grid with health dots
2. Green dot on status tile -> everything healthy
3. Red dot on tasks tile -> at least one task failed recently
4. Operator clicks a tile -> navigates to full dashboard
5. Auth expired -> redirects to `/auth/login`
6. Tiles auto-refresh every 30s to update summaries
7. Unknown path under `/dash/` -> 404

## Not in Scope

- Per-group dashboards (mount at `/dash/<folder>/<name>/`)
- Mutations (kill, restart, clear, edit)
- WebSocket (HTMX polling sufficient)
- Build tooling for dashboard frontends
- Mobile-optimized layout
