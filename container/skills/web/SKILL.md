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

## Post-deploy verification

ALWAYS verify after creating or editing a page:

```bash
URL="https://$WEB_HOST/$GROUP_FOLDER/myapp/"
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

## When to use web

Deploy to web when:

- The user explicitly asks for a web page
- The output is voluminous — anything that would be a long PDF,
  a multi-section guide, a research report, an itinerary, etc.
  Web is better than sending a file the user has to download and
  open separately. Prefer web over PDFs and send_file for anything
  longer than a few paragraphs.

Do NOT use web when:

- The user explicitly asks for a file (send_file, PDF, download)
- The content is short enough for a chat message
- It's raw data (CSV, JSON, archives, code files)

## Pages (disposable content)

For one-off content (guides, research, reports, itineraries) that
isn't a persistent app:

1. Create in `$WEB_DIR/pages/YYYY-MM-DD/<slug>/index.html`
2. Update `$WEB_DIR/pages/index.html` — a simple date-organized
   link list (most recent first)
3. Send the URL in chat
4. Ask the user: "want me to add this to the main index too?"
   Only add to group hub if they say yes.

Pages index is auto-maintained — add a link entry every time you
create a page. Format: date heading, link + one-line description.
If pages/index.html doesn't exist yet, create it (minimal HTML
with shared hub.css styling).
