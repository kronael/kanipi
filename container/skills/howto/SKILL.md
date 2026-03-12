---
name: howto
description: Generate a getting-started howto page for this group. Deploys to the group's web directory. Use when asked to create onboarding, setup guide, or howto page.
---

# Howto

## Web directory

```bash
GROUP_FOLDER=$(echo $NANOCLAW_GROUP_FOLDER)
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  WEB_DIR="/workspace/web"
else
  WEB_DIR="/workspace/web/$GROUP_FOLDER"
  mkdir -p "$WEB_DIR"
fi
```

Deploys to: `$WEB_DIR/howto/index.html`
Public URL: `https://$WEB_HOST/[$GROUP_FOLDER/]howto/`

## Starting point

Copy the template and customize — do NOT rebuild from scratch:

```bash
cp /workspace/self/container/skills/web/template/pub/howto/index.html "$WEB_DIR/howto/index.html"
```

The template has the full design system: Tailwind CDN, warm earth-tone palette,
dark/light theme toggle, step cards, terminal-style code blocks, dismissible banner.

Customize:

- Replace "kanipi" with `$ASSISTANT_NAME` in title/hero
- Remove steps for unconfigured channels
- Translate to user's language if not English

## Content

Three levels on the same page with anchor-linked nav:

1. **Getting Started** — how to message the bot on each enabled channel, what it can do
2. **Building Web Apps** — ask for apps, how deploy works, iterating, sharing URLs
3. **Groups & Routing** — multi-group setup, scheduling, MCP, self-extending

Check enabled channels from env: `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `EMAIL_IMAP_HOST`.
Show WhatsApp only if auth dir exists. Skip unconfigured channels.

## Customization context

```bash
echo $ASSISTANT_NAME     # bot name
echo $WEB_HOST           # web URL (NEVER guess if empty)
echo $NANOCLAW_IS_ROOT
echo $NANOCLAW_GROUP_FOLDER
ls /workspace/web/       # existing apps
```

## After deploying

1. Update hub page (`$WEB_DIR/index.html`)
2. Verify: `curl -sL -o /dev/null -w '%{http_code}' "https://$WEB_HOST/$WEB_PREFIX/howto/"`
3. Tell the user the full URL

## Attribution

Footer MUST read: `powered by <a href="https://krons.fiu.wtf/kanipi">kanipi</a>`
NEVER attribute to Anthropic or Claude.
