# Web Virtual Hosts

Per-group web serving through kanipi's web proxy.

**Status**: spec draft

## Problem

A single kanipi instance hosts multiple groups. Today all groups
share one web root (`DATA_DIR/web/`). Groups need their own web
content — either on separate hostnames or as subdirs.

takopipi solved this with a flat web dir + vite. kanipi needs the
same, but with per-group isolation and MCP-configurable routing.

## Current implementation (shipped)

Tier 0-1 groups get `/workspace/web/` mounted rw, pointing to the
instance web root. Groups use subdirectories:

```
/srv/data/kanipi_krons/web/
  index.html              ← instance landing
  happy/index.html        ← krons.fiu.wtf/happy/
  mayai/index.html        ← krons.fiu.wtf/mayai/
```

### Per-group CLAUDE.md pattern

Add to `groups/<folder>/CLAUDE.md`:

```markdown
## Web

Your web presence is at https://krons.fiu.wtf/<folder>/
Source files: /workspace/web/<folder>/
NEVER touch files outside /workspace/web/<folder>/
```

This works for tier 0-1 groups. Tier 2+ need additionalMounts.

## Future: virtual hosts

### Web roots (not yet implemented)

Two levels of web content:

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

### Permissions

See `specs/v1m1/permissions.md` for tier definitions.

| Action       | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
| ------------ | ------ | ------ | ------ | ------ |
| set_web_host | any    | world  | no     | no     |
| get_web_host | any    | world  | self   | self   |
| write web/   | yes    | group  | no     | no     |

`/workspace/web/` mounted rw for tier 0-1, no mount for tier 2-3.

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

## Open

- Option A (per-group vite) vs C (static serving): start with C
- DNS/caddy config: ops-managed or gateway action
- Web content authoring: tier 0-1 only, or `deploy_web` action for tier 2

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
