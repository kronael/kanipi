---
name: hello
description: Send a welcome message to introduce yourself and explain what you can do. Use on first contact with a new user or group, or when asked to introduce yourself.
---

# Hello

Send a friendly welcome message that introduces the bot
and explains what it can do. Keep it short and actionable.

## When to use

- First message from a new user or group
- User asks "who are you" or "what can you do"
- User says "hello" or "hi" with no other context

## Message format

If `~/.claude/SOUL.md` exists, read it first and introduce yourself in that
persona. Otherwise use the default below.

Write a short welcome (3-5 lines max). Include:

1. **Name** — introduce yourself (read SOUL.md or $ASSISTANT_NAME)
2. **What you do** — one sentence about your capabilities
3. **How to use** — "Send me a message with what you need."
4. **Web apps** — if WEB_HOST is set: mention you can deploy web apps
5. **Howto link** — if howto page exists: link it

## Web prefix

Skills publish web content under a group-specific prefix:

```bash
# Detect web prefix for this group
GROUP_FOLDER=$(basename /workspace/group)
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  WEB_PREFIX=""  # root publishes at web root
else
  WEB_PREFIX="$GROUP_FOLDER"
fi
```

When linking the howto page:

- Root group: `https://$WEB_HOST/howto/`
- Other groups: `https://$WEB_HOST/$GROUP_FOLDER/howto/`

Check if the howto exists before linking:

```bash
GROUP_FOLDER=$(basename /workspace/group)
if [ "$NANOCLAW_IS_ROOT" = "1" ]; then
  ls /workspace/web/howto/index.html 2>/dev/null
else
  ls /workspace/web/$GROUP_FOLDER/howto/index.html 2>/dev/null
fi
```

## Tone

- Friendly but not chatty
- No emojis unless the user uses them
- Match the user's language (Czech if they write Czech, etc.)
- Never list every capability — keep it high-level

## Context detection

Before sending, check:

- `echo $ASSISTANT_NAME` for bot name
- `echo $WEB_HOST` for web URL
- `echo $NANOCLAW_IS_ROOT` and `basename /workspace/group` for web prefix
- The user's message language to reply in the same language

## Capability levels

Tailor the intro based on what the user might need. Three levels
of usage (don't enumerate these — pick what fits the audience):

**Level 1 — Research & daily use**: Deep web research, reviewing
products, comparing options, searching concepts, explaining topics.
Good for shopping, learning, decision-making.

**Level 2 — Web apps & dashboards**: Building interactive web
pages, data dashboards, tools, calculators. Code apps that deploy
instantly to a live URL.

**Level 3 — Multi-agent & routing**: Groups, delegation, scheduled
tasks, automated pipelines. Advanced orchestration.

For most users, mention levels 1-2 only. Level 3 is for power users.

## Example output (root group)

```
Hi, I'm krons — a Kanipi agent. I can research topics deeply,
build web apps, and help with coding and analysis.

Send me a message with what you need. I can also deploy web
apps and dashboards for you at krons.fiu.wtf.

Getting started: https://krons.fiu.wtf/howto/
```

## Example output (myai group)

```
Hi, I'm myai — part of the krons instance. I can research,
code, build web apps, and help with daily tasks.

Send me what you need. Web apps I build go live at
krons.fiu.wtf/myai/.

Getting started: https://krons.fiu.wtf/myai/howto/
```
