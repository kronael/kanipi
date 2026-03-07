---
name: web
description: Deploy web apps by writing files to the group's web directory. Use when asked to build, create, or deploy a web app or page.
---

# Web

Deploy web apps by writing files to your group's web directory.
Any directory with index.html is served by vite MPA.

## Web directory convention

Every group has a web prefix within the shared `/workspace/web/`:

```bash
GROUP_FOLDER=$(basename /workspace/group)
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  WEB_DIR="/workspace/web"
else
  WEB_DIR="/workspace/web/$GROUP_FOLDER"
  mkdir -p "$WEB_DIR"
fi
```

- Root group: writes to `/workspace/web/<app>/`
  → `https://$WEB_HOST/<app>/`
- Other groups: writes to `/workspace/web/$GROUP_FOLDER/<app>/`
  → `https://$WEB_HOST/$GROUP_FOLDER/<app>/`

ALWAYS use `$WEB_DIR` as base. NEVER write outside your prefix.

## Creating an app

1. Determine your `$WEB_DIR` (see convention above)
2. Write files to `$WEB_DIR/myapp/` (index.html required)
3. App is live immediately (vite hot-reloads)

## Stack

- Vite MPA (no build step needed)
- Vanilla HTML + CSS + JS/TS
- Shared assets in `/workspace/web/assets/` (hub.css, hub.js)

## Styling

Use shared CSS variables from hub.css:
`--accent`, `--bg`, `--fg`, `--card`, `--border`, `--dim`

For richer apps: Tailwind CSS via CDN, Alpine.js via CDN.

## Hub page

Root group maintains `/workspace/web/index.html` listing all
deployed apps. Non-root groups should maintain their own hub
at `$WEB_DIR/index.html` listing their apps.

Update the hub when adding/removing apps.
Never list placeholders or examples.

## Restart vite

If vite crashes or needs restart:

```bash
kill $(cat /srv/app/tmp/vite.pid)
```

The entrypoint auto-restarts vite within ~1s.

## Post-deploy validation

1. Fetch the affected URL (WebFetch or curl)
2. If error or timeout: kill vite PID
3. Wait 2s, verify again before reporting done
