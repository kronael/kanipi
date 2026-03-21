---
name: howto
description: Generate a comprehensive howto page for this group. Documents all
  features including memory, knowledge, scheduling, web apps. Deploys to the
  group's web directory.
---

# Howto

Generates a user-facing howto page covering 20 topics. Users see TLDRs
first (quick reference), then full deep-dive sections below.

## Web directory

```bash
GROUP_FOLDER=$NANOCLAW_GROUP_FOLDER
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
mkdir -p "$WEB_DIR/howto"
cp /workspace/self/templates/default/.claude/skills/web/template/pub/howto/index.html \
   "$WEB_DIR/howto/index.html"
```

The template has the full design system: Tailwind CDN, warm earth-tone palette,
dark/light theme toggle, all 20 sections pre-built with TLDRs + examples.

## Customization

Minimal required changes:

1. Replace `kanipi agent` in `<title>` and `<h1>` with `$ASSISTANT_NAME`
2. Replace hero tagline if you have a more specific description
3. Remove sections for capabilities not configured:
   - Section 06 (Voice): only if no channel supports voice
   - Section 19 (Groups): only if this is a standalone single-group setup
   - Section 20 (Onboarding): only if `ONBOARDING_ENABLED` is not set
4. In section 12 (Web Apps), replace `bot.example.com/mygroup/` with actual `$WEB_HOST/$GROUP_FOLDER/`
5. In section 14 (Dashboard), replace `bot.example.com/dash/` with actual URL

Do NOT rewrite content from scratch — the template already has accurate,
minimal, doc-like content for all 20 topics.

## Customization context

```bash
echo $ASSISTANT_NAME
echo $WEB_HOST           # NEVER guess if empty
echo $NANOCLAW_IS_ROOT
echo $NANOCLAW_GROUP_FOLDER
env | grep -E 'TELEGRAM|DISCORD|EMAIL_IMAP'   # enabled channels
ls /workspace/web/ 2>/dev/null                 # existing apps
```

## 20 Topics covered

| #   | Topic                  | TLDR                                                     |
| --- | ---------------------- | -------------------------------------------------------- |
| 01  | Getting Started        | Send a message — agent responds in its own container     |
| 02  | Gateway Commands       | /new /stop /ping /chatid /status /file — first word only |
| 03  | Topic Sessions #       | #topic routes to named session, separate context         |
| 04  | Agent Routing @        | @name routes to child agent, token stripped              |
| 05  | Files & Attachments    | Attach to send, /file put/get/ls for workspace           |
| 06  | Voice Messages         | Auto-transcribed, agent gets text not audio              |
| 07  | Memory & Diary         | Diary + MEMORY.md persist across sessions                |
| 08  | User Context           | Per-user files track preferences and role                |
| 09  | Facts System           | /facts creates verified knowledge, 14-day freshness      |
| 10  | Episodes & Compression | /compact-memories → weekly/monthly summaries             |
| 11  | Recall Search          | /recall-memories searches all stores at once             |
| 12  | Web Apps               | Build and deploy to $WEB_HOST live                       |
| 13  | Scheduling             | Cron/interval/once tasks, isolated prompt                |
| 14  | Dashboard              | /dash/ portal: status, tasks, groups, memory             |
| 15  | Skills                 | /skill-name commands, extensible, /migrate to sync       |
| 16  | Research & Web         | Live search, browser, yt-dlp, pandoc                     |
| 17  | Data & Visualization   | pandas/plotly charts, Excel, PowerPoint, PDF             |
| 18  | Coding & Dev           | Node/Python/Go/Rust, run code, send output               |
| 19  | Groups & Tiers         | Worlds contain children, shared /workspace/share         |
| 20  | Onboarding             | /request → operator /approve → world created             |

## After deploying

1. Ensure `$WEB_DIR/index.html` exists and links to `howto/`. If missing:
   ```bash
   echo '<a href="howto/">Getting Started →</a>' > "$WEB_DIR/index.html"
   ```
2. Verify: `curl -sL -o /dev/null -w '%{http_code}' "https://$WEB_HOST/$GROUP_FOLDER/howto/"`
3. Tell the user the full URL

## Attribution

Footer MUST read: `powered by <a href="https://krons.fiu.wtf/kanipi">kanipi</a>`
NEVER attribute to Anthropic or Claude.
