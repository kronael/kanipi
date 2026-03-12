---
name: web
description: Deploy web apps and pages by writing files to the group's web directory.
---

# Web

Any directory under `$WEB_DIR` with `index.html` is served by vite MPA.

## When to use web

Prefer web when:

- The user asks for a web page
- Content is rich or long — guides, reports, itineraries,
  multi-section documents. Web beats sending a file the user
  must download and open separately.

Use send_file instead when:

- The user explicitly asks for a file/PDF/download
- Content is short enough for a chat message
- It's raw data (CSV, JSON, archives, code)

## Web directory convention

Every group has a web prefix within the shared `/workspace/web/`:

```bash
GROUP_FOLDER=$(echo $NANOCLAW_GROUP_FOLDER)
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

## Post-deploy verification

ALWAYS verify after creating or editing a page:

```bash
# Replace <path> with actual app/page path under WEB_DIR
URL="https://$WEB_HOST/$GROUP_FOLDER/<path>/"
STATUS=$(curl -sL -o /dev/null -w '%{http_code}' "$URL")
if [ "$STATUS" != "200" ]; then
  echo "FAIL: $URL returned $STATUS"
  kill $(cat /srv/app/tmp/vite.pid) 2>/dev/null
  sleep 2
  STATUS=$(curl -sL -o /dev/null -w '%{http_code}' "$URL")
fi
echo "OK: $URL → $STATUS"
```

NEVER report a page as done without verifying it loads.

## Pages (disposable content)

For one-off content (guides, research, reports, itineraries)
that isn't a persistent app:

1. Create `$WEB_DIR/pages/YYYY-MM-DD/<slug>/index.html`
2. Add link to `$WEB_DIR/pages/index.html` (date heading,
   link + one-line description, most recent first)
3. Verify with curl (see above)
4. Send the URL in chat

Create `pages/index.html` on first use (minimal HTML with
hub.css styling). Do NOT add pages to the group hub — the
pages index is their own listing.

## Scaffold

If `/workspace/web/` is missing or needs to be rebuilt from scratch, scaffold
it from the built-in template:

```bash
cp -rn /workspace/self/container/skills/web/template/. /workspace/web/
cd /workspace/web && npm install --silent
```

Then verify vite is running (see Restart vite above).
