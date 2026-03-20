---
name: howto
description: Generate a comprehensive howto page for this group. Documents all
  features including memory, knowledge, scheduling, web apps. Deploys to the
  group's web directory.
---

# Howto

## Web directory

```bash
GROUP_FOLDER=$NANOCLAW_GROUP_FOLDER
# /workspace/web is always mounted at the world level.
# Root: /workspace/web = web root
# World (tier 1): /workspace/web = web/<world>/
# Child (tier 2): /workspace/web = web/<world>/ — use basename only
if [ "$NANOCLAW_IS_ROOT" = "1" ] || [ "$NANOCLAW_IS_WORLD_ADMIN" = "1" ]; then
  WEB_DIR="/workspace/web"
else
  WEB_SUB=$(basename "$GROUP_FOLDER")
  WEB_DIR="/workspace/web/$WEB_SUB"
  mkdir -p "$WEB_DIR"
fi
```

Deploys to: `$WEB_DIR/howto/index.html`
Public URL: `https://$WEB_HOST/$GROUP_FOLDER/howto/`

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

Progressive disclosure — six sections with anchor-linked nav:

### 1. Getting Started

How to message the bot on each enabled channel. What it can do.
Check enabled channels from env: `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`,
`EMAIL_IMAP_HOST`. Show WhatsApp only if auth dir exists. Skip unconfigured.

### 2. Memory & Knowledge

How the assistant remembers and learns:

- **Diary** — daily work log (`diary/YYYYMMDD.md`). Agent writes during sessions.
  Gateway injects last 14 days on session start.
- **MEMORY.md** — persistent preferences, patterns. Agent-managed, always loaded.
- **User context** — per-user files (`users/<id>.md`). Preferences, interaction log.
- **Facts** — researched knowledge (`facts/`). `/facts` skill creates, verifies,
  refreshes. 14-day freshness gate.
- **Episodes** — compressed session transcripts. Daily/weekly/monthly summaries
  in `episodes/`. Created by `/compact-memories` cron tasks.
- **Diary summaries** — weekly/monthly compressed diary in `diary/week/`, `diary/month/`.
- **Recall** — `/recall-memories <question>` searches knowledge stores by `summary:` frontmatter.

### 3. Building Web Apps

Ask for apps, how deploy works, iterating, sharing URLs.
Web directory: `$WEB_DIR/`. Public at `https://$WEB_HOST/`.

### 4. Scheduling & Automation

- Cron tasks: recurring prompts on schedule (cron or interval)
- Context modes: `group` (reuses session) or `isolated` (fresh container)
- Memory compaction: `/compact-memories` runs daily/weekly/monthly crons
- Gateway commands: `/new`, `/stop`, `/ping`, `/chatid`

### 5. Groups & Routing

Multi-group setup, nested groups (tiers 0-3), routing rules
(command/pattern/keyword/sender/default), shared memory across groups.

### 6. Tools & Capabilities

Runtimes (node, python, go, rust), media tools (ffmpeg, imagemagick),
research (web search, browser, pandoc), data (pandas, plotly),
office (slides, excel), MCP extensions.

## Customization context

```bash
echo $ASSISTANT_NAME     # bot name
echo $WEB_HOST           # web URL (NEVER guess if empty)
echo $NANOCLAW_IS_ROOT
echo $NANOCLAW_GROUP_FOLDER
ls /workspace/web/       # existing apps
```

## After deploying

1. Ensure `$WEB_DIR/index.html` exists and links to `howto/`. If missing, create a
   minimal one: `<a href="howto/">Getting Started →</a>`
2. Verify: `curl -sL -o /dev/null -w '%{http_code}' "https://$WEB_HOST/$GROUP_FOLDER/howto/"`
3. Tell the user the full URL

## Attribution

Footer MUST read: `powered by <a href="https://krons.fiu.wtf/kanipi">kanipi</a>`
NEVER attribute to Anthropic or Claude.
