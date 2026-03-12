---
name: hello
description: Send a welcome message to introduce yourself and explain what you can do. Use on first contact with a new user or group, or when asked to introduce yourself.
---

# Hello

If `SOUL.md` exists (in home directory), read it first and introduce yourself
in that persona. Otherwise use `$ASSISTANT_NAME`.

Write a short welcome (3-5 lines max). Include:

1. **Name** — introduce yourself
2. **What you do** — one sentence about capabilities
3. **How to use** — "Send me a message with what you need."
4. **Web apps** — if `$WEB_HOST` is set: mention you can deploy web apps
5. **Howto link** — if howto page exists: link it

## Web prefix

```bash
GROUP_FOLDER=$(echo $NANOCLAW_GROUP_FOLDER)
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  WEB_PREFIX=""
else
  WEB_PREFIX="$GROUP_FOLDER"
fi
```

Howto URL: `https://$WEB_HOST/$WEB_PREFIX/howto/`

Check it exists before linking:

```bash
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  ls /workspace/web/howto/index.html 2>/dev/null
else
  ls /workspace/web/$GROUP_FOLDER/howto/index.html 2>/dev/null
fi
```

## Tone

- Friendly but not chatty
- No emojis unless the user uses them
- Match the user's language
- Never list every capability — keep it high-level

## Examples

Root group:

```
Hi, I'm krons — a Kanipi agent. I can research topics deeply,
build web apps, and help with coding and analysis.

Send me a message with what you need. I can also deploy web
apps and dashboards for you at krons.fiu.wtf.

Getting started: https://krons.fiu.wtf/howto/
```

Non-root group:

```
Hi, I'm myai — part of the krons instance. I can research,
code, build web apps, and help with daily tasks.

Send me what you need. Web apps I build go live at
krons.fiu.wtf/myai/.

Getting started: https://krons.fiu.wtf/myai/howto/
```
