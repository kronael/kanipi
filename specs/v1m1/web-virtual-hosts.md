# Web Virtual Hosts

Per-group web serving through kanipi's web proxy.

**Status**: spec draft

## Problem

A single kanipi instance hosts multiple groups. Today all groups
share one web root (`DATA_DIR/web/`). Groups need their own web
content — either on separate hostnames or as subdirs.

takopipi solved this with a flat web dir + vite. kanipi needs the
same, but with per-group isolation and MCP-configurable routing.

## Design

### Web roots

Two levels of web content:

```
/srv/data/kanipi_krons/
  web/                    ← instance web root (default host)
  groups/
    main/web/             ← group web root (optional)
    myai/web/             ← group web root (optional)
```

Instance web root is the fallback. Group web roots are optional —
if `groups/<folder>/web/` doesn't exist, the group has no web.

### Host routing

The web proxy resolves which root to serve based on `Host` header.

```sql
ALTER TABLE registered_groups ADD COLUMN web_host TEXT;
```

Proxy logic:

1. Match `Host` header against `registered_groups.web_host`
2. If matched → serve from `groups/<folder>/web/`
3. If no match → serve from instance `web/`

Instance-level `WEB_HOST` in .env remains the default host.
Group `web_host` values are for additional hostnames.

### MCP configuration

Agents configure web hosts through gateway IPC actions, same
pattern as other group settings. New actions:

```
set_web_host   { folder, host }     tier 0-1
get_web_host   { folder }           tier 0-2
```

CLI equivalent:

```bash
./kanipi config <instance> group set-web-host myai myai.fiu.wtf
```

The gateway validates:

- `host` is a valid hostname (no scheme, no path)
- No duplicate hosts across groups
- Folder exists and caller has permission

### Permission tiers (from permissions.md)

| Action       | Tier 0 (root) | Tier 1 (world) | Tier 2 (agent) | Tier 3 (worker) |
| ------------ | ------------- | -------------- | -------------- | --------------- |
| set_web_host | any           | own world      | no             | no              |
| get_web_host | any           | own world      | own group      | own group       |
| write web/   | yes           | own group      | no             | no              |

Tier 2 agents cannot modify web content or host config. This
prevents prompt injection from exposing arbitrary content on
the instance's domains.

Mount enforcement (from permissions.md):

```
/workspace/web/   rw for tier 0-1, no mount for tier 2-3
```

### Vite serving

Single vite process per web root. The kanipi entrypoint starts
vite for the instance web dir. Group web dirs need their own
vite processes (or static serving).

**Option A: one vite per web root** (current leaning)

- Instance vite: `DATA_DIR/web/` on internal port
- Group vite: `groups/<folder>/web/` on next available port
- Web proxy routes by host to correct vite port
- Each group web has its own `package.json` + `vite.config.ts`
- Pro: full isolation, groups can have custom vite plugins
- Con: memory cost per vite process (~50-100MB)

**Option B: single vite with multi-root**

- One vite process serves all web roots
- Proxy rewrites paths based on host before forwarding
- Pro: lower memory
- Con: all roots share one vite config, path collisions possible

**Option C: static serving for group webs**

- Only the instance gets vite (dev server + HMR)
- Group webs are served as static files by the proxy directly
- Pro: simplest, no extra processes
- Con: no HMR for group webs, no vite plugins

### WEB_PUBLIC interaction

`WEB_PUBLIC=1` applies instance-wide: all virtual hosts skip
auth and the `/pub/` redirect. Per-host auth is a future concern.

### Vite plugins (from takopipi)

Two useful plugins from takopipi's vite config should be standard
in kanipi's web template:

- **trailing-slash**: redirects `/path` to `/path/` when a
  directory with index.html exists (already in template)
- **js-viewer-rewrite**: serves `foo.js.html` when `foo.js`
  is requested, enabling HTML viewers for JS files (added)

## Open questions

1. **Option A vs B vs C?** Option A is cleanest but heaviest.
   Option C is simplest for v1. Could start with C and upgrade
   to A when a group actually needs HMR.

2. **DNS / reverse proxy**: who creates the DNS records and
   caddy/nginx config for new hostnames? Currently manual.
   Should the gateway expose an action that writes caddy config?
   Or is this always ops-side?

3. **Subdirectory routing alternative**: instead of virtual hosts
   (myai.fiu.wtf), could groups serve under subdirs of the
   instance host (krons.fiu.wtf/myai/). Simpler DNS, but vite
   `base` config gets messy. Host-based is cleaner.

4. **Group web bootstrapping**: when a group is created, should
   its web dir be seeded from a template? Or empty until the
   agent creates content? The instance web is seeded from
   `template/web/` — same pattern could work.

5. **Web content authoring**: who writes group web content? If
   tier 2 agents can't mount web/, only tier 0-1 can write.
   Should there be an IPC action for deploying web content
   (agent writes to workdir, then `deploy_web` copies to web/)?

6. **Hot reload across proxy**: if using option A (per-group
   vite), the web proxy needs to track which port maps to which
   host. Port allocation could be automatic (base port + offset)
   or configured per group.

## Implementation order

1. Add `web_host` column to `registered_groups`
2. Web proxy: route by `Host` header to group web dir
3. Static serving (option C) for group webs
4. CLI: `group set-web-host`
5. IPC action: `set_web_host` / `get_web_host`
6. Mount enforcement: no `/workspace/web/` for tier 2-3
7. (Later) Per-group vite if needed

## Related specs

- specs/v1m1/permissions.md — tier model, mount enforcement
- specs/v1m1/worlds-rooms.md — group hierarchy research
