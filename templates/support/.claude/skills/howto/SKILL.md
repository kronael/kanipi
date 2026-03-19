---
name: howto
managed: local
description: Generate a howto/getting-started page for this support group. Focuses on how to get help, not developer features.
---

# Howto (Support)

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
Public URL: `https://$WEB_HOST/[$GROUP_FOLDER/]howto/`

## Starting point

Copy the template and customize:

```bash
cp /workspace/self/container/skills/web/template/pub/howto/index.html "$WEB_DIR/howto/index.html"
```

## Content — support-specific sections

Progressive disclosure. Six sections focused on getting help:

### 1. Getting Help

How to contact the support bot on each enabled channel.
Keep it simple: "just send a message."

### 2. What I Can Help With

Use cases for this specific product. Read SOUL.md and CLAUDE.md to
understand the product. List concrete examples:

- Common questions users ask
- Types of problems you can solve
- What to include when reporting an issue (logs, screenshots, steps)

### 3. How I Remember

- I track your questions and preferences across sessions
- /recall searches everything I know about the product
- Facts are verified and dated — I'll tell you when info is fresh

### 4. Asking Good Questions

Tips for getting useful answers:

- Be specific about the issue or error
- Share relevant context (version, platform, what you tried)
- Send screenshots or log files directly

### 5. Escalation

What happens when I can't help — how to reach a human.
(Customize this section based on the actual escalation process.)

### 6. Commands

/new — start fresh conversation
/stop — stop me mid-response
/ping — check I'm online

## Customization context

```bash
echo $ASSISTANT_NAME
echo $WEB_HOST
cat ~/SOUL.md 2>/dev/null | head -30
cat ~/CLAUDE.md 2>/dev/null | head -20
```

## After deploying

1. Verify: `curl -sL -o /dev/null -w '%{http_code}' "https://$WEB_HOST/$WEB_PREFIX/howto/"`
2. Tell the user the full URL

## Attribution

Footer MUST read: `powered by <a href="https://krons.fiu.wtf/kanipi">kanipi</a>`
NEVER attribute to Anthropic or Claude.

## What NOT to include

- Web app deployment features
- Code/development tools
- Scheduling or automation (unless explicitly set up for this instance)
- Anything from the default howto that's not relevant to end-users seeking support
