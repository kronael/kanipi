---
status: shipped
---

# Dashboard Portal

Generic system for serving operator dashboards from the gateway.
A portal index lists all registered dashboards; each dashboard is
an independent module with its own routes. HTMX-based frontend
with fragment endpoints for partial updates.

## Design

```
/dash/                       -> portal index (lists all dashboards)
/dash/<name>/                -> dashboard shell (loads HTMX fragments)
/dash/<name>/x/<fragment>    -> HTML fragment (partial)
/dash/<name>/api/<path>      -> JSON API (programmatic)
```

### HTMX pattern

Dashboards use HTMX (loaded from CDN: unpkg.com/htmx.org). The main
page is a shell with `hx-get` attributes that load fragments from
`/dash/<name>/x/<fragment>` endpoints. Fragments return bare HTML
(table, list, paragraph) with no `<html>` wrapper. Auto-refresh
via `hx-trigger="every 10s"` on fragment containers.

```html
<div hx-get="/dash/status/x/gateway" hx-trigger="every 10s" hx-swap="innerHTML">
  Loading...
</div>
```

JSON API endpoints remain for programmatic use (scripts, monitoring).

### Portal index

`GET /dash/` returns a simple HTML page listing all registered
dashboards with title, description, and link. Dashboards self-register
at startup.

### Dashboard module

Each dashboard registers via `registerDashboard` with a handler
function that receives the raw Node http request/response:

```typescript
// src/dashboards/index.ts
registerDashboard({
  name: 'status',
  title: 'Status & Health',
  description: 'Gateway health, containers, queues, channels',
  handler: statusHandler,
});

function statusHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  ctx: DashboardContext,
): void {
  if (path === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildState(ctx)));
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

### DashboardContext

Shared context passed to every dashboard handler:

```typescript
interface DashboardContext {
  queue: GroupQueue;
  channels: Channel[];
}
```

Dashboards are trusted gateway code — they share the process and
DB. No sandboxing needed.

### Registration

```typescript
// src/dashboards/index.ts
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
}

const dashboards: DashboardEntry[] = [];

export function registerDashboard(entry: DashboardEntry): void {
  dashboards.push(entry);
}

export function handleDashRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: DashboardContext,
): void {
  const url = req.url || '/';
  if (url === '/dash' || url === '/dash/') {
    servePortal(res);
    return;
  }
  for (const d of dashboards) {
    const prefix = `/dash/${d.name}`;
    if (url === prefix || url.startsWith(prefix + '/')) {
      d.handler(req, res, url.slice(prefix.length) || '/', ctx);
      return;
    }
  }
  res.writeHead(404);
  res.end('Not found');
}
```

## Stories

1. Operator opens `/dash/` -> sees list of all registered dashboards
   with titles and descriptions
2. Operator clicks a dashboard -> navigates to that dashboard's page
3. Dashboard page loads -> HTMX fetches fragments to populate sections
4. Unknown dashboard path -> 404 response
5. Auth required -> redirects to login when auth is configured

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

HTMX loaded from CDN (`unpkg.com/htmx.org`), no build step.
Each dashboard serves a shell HTML page with `hx-get` attributes
pointing to fragment endpoints. Fragments return bare HTML partials.
JSON API endpoints remain for programmatic/scripting use.

No shared frontend framework. Each dashboard is self-contained.

## File layout

```
src/dashboards/
  index.ts          registration, portal handler, status dashboard
  types.ts          DashboardContext, DashboardEntry (if extracted)
```

## Gateway changes

1. `web-proxy.ts`: route `/dash/` prefix, auth check, delegate to
   `handleDashRequest` (not vite)
2. `src/dashboards/index.ts`: registration system, portal handler
3. Individual dashboard handlers register at module load

## Concrete dashboards

| Dashboard | Spec            | Description                          |
| --------- | --------------- | ------------------------------------ |
| status    | 4/P-dash-status | Uptime, channels, containers, queues |
| memory    | 4/Q-dash-memory | Browse knowledge stores, sessions    |

## Not in scope

- Per-group dashboards (mount at `/dash/<folder>/<name>/`) -- future
- Mutations (kill container, clear queue) -- future
- WebSocket -- HTMX polling sufficient for v1
- Build tooling for dashboard frontends -- keep it static
