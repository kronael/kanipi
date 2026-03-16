---
status: open
---

# Dashboard Portal

Generic system for serving operator dashboards from the gateway.
A portal index lists all registered dashboards; each dashboard is
an independent module with its own routes and static frontend.

## Design

```
/dash/                    → portal index (lists all dashboards)
/dash/<name>/             → dashboard frontend (static HTML)
/dash/<name>/api/<path>   → dashboard API routes (JSON)
```

### Portal index

`GET /dash/` returns a simple HTML page listing all registered
dashboards with name, description, and link. No framework — a
`<ul>` of `<a>` elements. Dashboards self-register at startup.

### Dashboard module

Each dashboard is a TypeScript file that exports a registration
function:

```typescript
// src/dashboards/status.ts
import type { DashboardContext } from './types.js';

export const meta = {
  name: 'status',
  title: 'Status & Health',
  description: 'Gateway health, containers, queues, errors',
};

export function register(ctx: DashboardContext): void {
  ctx.router.get('/api/state', (req, res) => {
    res.json(buildState(ctx));
  });
}
```

### DashboardContext

Shared context passed to every dashboard at registration:

```typescript
interface DashboardContext {
  router: Router; // Express router scoped to /dash/<name>/
  db: Database; // SQLite connection (read-only recommended)
  queue: GroupQueue; // queue state (active JIDs, counts)
  channels: Channel[]; // connected channels
}
```

Dashboards are trusted gateway code — they share the process and
DB. No sandboxing needed.

### Registration

```typescript
// src/dashboards/index.ts
import type { Express } from 'express';
import { Router } from 'express';

interface DashboardMeta {
  name: string;
  title: string;
  description: string;
}

const dashboards: DashboardMeta[] = [];

export function registerDashboard(
  app: Express,
  meta: DashboardMeta,
  register: (ctx: DashboardContext) => void,
  ctx: Omit<DashboardContext, 'router'>,
): void {
  const router = Router();
  register({ ...ctx, router });
  app.use(`/dash/${meta.name}`, router);
  dashboards.push(meta);
}

export function portalHandler(req, res): void {
  const html = dashboards
    .map(
      (d) =>
        `<li><a href="/dash/${d.name}/">${d.title}</a> — ${d.description}</li>`,
    )
    .join('\n');
  res.send(`<html><body><h1>Dashboards</h1><ul>${html}</ul></body></html>`);
}
```

## Auth

All `/dash/*` routes require auth (same cookie/session as gateway
web). The portal and individual dashboards are behind the same
`checkAuth` middleware used by `web-proxy.ts`.

```typescript
// in web-proxy.ts
if (url.startsWith('/dash/')) {
  if (!checkAuth(req, authSecret)) {
    res.writeHead(302, { Location: '/auth/login' });
    res.end();
    return;
  }
}
```

## Frontend

Each dashboard ships a single `index.html` file — vanilla HTML +
fetch, no build step. Served as the default route for the dashboard
router. Dashboards that need real-time use SSE via their own
`/api/stream` endpoint.

No shared frontend framework. Each dashboard is self-contained.

## File layout

```
src/dashboards/
  index.ts          registration, portal index handler
  types.ts          DashboardContext, DashboardMeta
  status.ts         status & health dashboard
  status.html       status frontend
  memory.ts         memory browser dashboard
  memory.html       memory frontend
```

## Gateway changes

1. `web-proxy.ts`: route `/dash/` prefix, auth check, proxy to
   dashboard handlers (not vite)
2. `src/dashboards/index.ts`: registration system, portal handler
3. Individual dashboard modules register at gateway startup

## Concrete dashboards

| Dashboard | Spec            | Description                          |
| --------- | --------------- | ------------------------------------ |
| status    | 4/P-dash-status | Uptime, channels, containers, queues |
| memory    | 4/Q-dash-memory | Browse knowledge stores, sessions    |

## Not in scope

- Per-group dashboards (mount at `/dash/<folder>/<name>/`) — future
- Mutations (kill container, clear queue) — future
- WebSocket — SSE sufficient for v1
- Build tooling for dashboard frontends — keep it static
