# Web Virtual Hosts

Per-group web roots served through kanipi's web proxy.

## Problem

A single kanipi instance may host multiple groups. Today all groups
share one web root (`DATA_DIR/web/`). Groups like "myai" need their
own web content separate from the instance's main site.

## Design

### Group web dirs

Each group can have its own web content at `groups/<folder>/web/`.
The instance-level `DATA_DIR/web/` remains the default/fallback.

```
/srv/data/kanipi_krons/
  web/                    ← instance web root (krons.fiu.wtf)
  groups/
    main/                 ← Krons group
    myai/
      web/                ← myai web root
```

### Routing

The web proxy resolves which web root to serve based on the `Host`
header. A group registers a `web_host` in the DB:

```sql
ALTER TABLE registered_groups ADD COLUMN web_host TEXT;
-- e.g. UPDATE registered_groups SET web_host = 'myai.fiu.wtf' WHERE folder = 'myai';
```

Proxy logic:

1. Match `Host` header against `registered_groups.web_host`
2. If matched → proxy to vite with root = `groups/<folder>/web/`
3. If no match → proxy to instance web root (`DATA_DIR/web/`)

### Vite

Single vite process serves all roots. Use vite's `server.fs.allow`
to whitelist group web dirs. The proxy rewrites paths before
forwarding to vite.

Alternative: one vite per web root (heavier, but simpler isolation).
Start with the single-vite approach — split later if needed.

### Config

```env
# .env — no new vars needed
# web_host is per-group in DB
```

Register via CLI:

```bash
./kanipi config <instance> group set-web-host myai myai.fiu.wtf
```

### WEB_PUBLIC interaction

`WEB_PUBLIC=1` applies instance-wide: all virtual hosts skip auth.
Per-host auth can come later if needed.

## Out of scope

- SSL termination (handled by reverse proxy / caddy)
- Per-group vite build configs
- Subdirectory routing (e.g. krons.fiu.wtf/myai/) — host-based only
