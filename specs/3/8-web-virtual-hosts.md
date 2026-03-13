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

### Explicit hostname assignment

Root agent assigns hostnames when setting up a world. No
convention, no automatic mapping. The infra skill guides
root through the process:

1. Root registers a world (`register_group`)
2. Infra skill asks: "what hostname for this world?"
3. Root writes the mapping to `vhosts.json` at web root
4. Vite middleware picks it up

```json
// DATA_DIR/web/vhosts.json
{
  "krons.fiu.wtf": "krons",
  "support.acme.co": "atlas"
}
```

No gateway code, no DB table, no IPC actions. Root has rw
access to `/workspace/web/` and edits the file directly.

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
that guides instance-level setup. When root sets up a world,
the skill covers:

- Hostname assignment (write to `vhosts.json`)
- DNS verification (resolve check)
- SSL/TLS notes (caddy auto-cert or manual)
- Web directory structure

The infra skill is baked into the agent image for tier 0 only.
Worlds don't see it. Root has rw access to `/workspace/web/`
and edits config files directly — no IPC actions needed.

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

1. Vite middleware: read `vhosts.json`, route by `Host` header
2. Change tier 1 mount: `/workspace/web/` → `DATA_DIR/web/<world>/`
3. `infra` skill for root agent (world setup guide, vhost management)

## Related

- `specs/3/5-permissions.md` — tier model, mount table
