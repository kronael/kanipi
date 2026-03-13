---
status: spec
---

# Web Virtual Hosts

Convention-based hostname routing. Root agent manages infra.
Worlds write content to their subdirectory.

## Problem

A single kanipi instance hosts multiple worlds. Each world needs
its own hostname (`krons.fiu.wtf`, `atlas.fiu.wtf`) without
per-world configuration in the gateway.

## Design

### Convention-based routing

DNS wildcard (`*.fiu.wtf`) resolves all subdomains. Web server
maps `Host` header to directory:

```
{world}.{WEB_DOMAIN} → DATA_DIR/web/{world}/
```

No DB table, no IPC actions, no gateway code. The mapping is
implicit — registering a world gives it a hostname.

`.env`:

```
WEB_DOMAIN=fiu.wtf
```

### Mount changes

Root owns the web root (vite config, top-level assets). Worlds
write to their subdirectory only.

| Mount                     | Tier 0 | Tier 1              | Tier 2+ |
| ------------------------- | ------ | ------------------- | ------- |
| `/workspace/web`          | rw     | no                  | no      |
| `/workspace/web/<world>/` | —      | rw (own world only) | no      |

Tier 1 sees `/workspace/web/` as a directory containing only its
own world subdirectory. Implemented as a bind mount of
`DATA_DIR/web/<world>/` → `/workspace/web/` inside the container.

### Vite config

Vite serves from `DATA_DIR/web/`. Config lives at the web root
alongside `index.html`. Root agent (tier 0) owns vite config —
restart, middleware, build settings.

Vite middleware handles hostname routing:

```typescript
// Pseudocode — vite plugin or middleware
function vhostMiddleware(req, res, next) {
  const host = req.headers.host;
  const sub = host?.split('.')[0];
  if (sub && existsSync(join(webDir, sub))) {
    req.url = `/${sub}${req.url}`;
  }
  next();
}
```

No per-world vite process. One vite instance, one middleware.

### Root infra skill

Root agent gets an `infra` skill (`~/.claude/skills/infra/`)
responsible for instance-level operations:

- Web server config (vite middleware, vhost routing)
- DNS verification (check subdomain resolves)
- SSL/TLS (caddy auto-cert or similar)
- Instance health checks

The infra skill is baked into the agent image for tier 0 only.
Worlds don't see it.

Actions the root agent performs via infra skill (no new IPC —
root has rw access to web config):

- Edit vite config directly
- Restart vite process (via `/workspace/web/` file watch or signal)
- Add/remove custom domain overrides in a `vhosts.json` at web root

### Custom domains (optional, v2)

For non-convention hostnames (`coolsite.com` → world `krons`),
a `vhosts.json` at the web root:

```json
{
  "coolsite.com": "krons",
  "support.acme.co": "atlas"
}
```

Read by the vite middleware. Root agent edits this file. DNS and
SSL setup is manual or caddy-managed.

## World workflow

A tier 1 world agent writes web content:

```
/workspace/web/index.html     ← its own web root
/workspace/web/assets/         ← static files
```

Inside the container, `/workspace/web/` is bind-mounted to
`DATA_DIR/web/<world>/`. The world doesn't know about hostnames —
it just writes files. The vhost middleware serves them at
`{world}.{domain}`.

## Implementation order

1. Add `WEB_DOMAIN` to `.env` / config.ts
2. Vite middleware for hostname → subdirectory routing
3. Change tier 1 mount: `/workspace/web/` → `DATA_DIR/web/<world>/`
4. Root infra skill (skeleton)
5. Custom domains via `vhosts.json` (optional)

## Related

- `specs/3/5-permissions.md` — tier model, mount table
