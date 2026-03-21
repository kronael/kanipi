---
status: shipped
---

# Agent-Initiated Status Updates

Agent emits `<status>` blocks for long or complex tasks to acknowledge
the work and set time expectations. The agent-runner extracts them, sends
each as an interim message, and strips them from the final text. Not for
simple one-step replies.

## Problem

The old 100-message heartbeat was mechanical and misleading — random text
snippets on SDK-internal messages. The agent had no way to signal deliberate
progress to the user.

## Design

- `<status>text</status>` — one line, under 100 chars, multiple per turn OK
- Agent-runner extracts and sends each as `writeOutput` with result prefixed
  by a hourglass emoji, then sends the cleaned final text
- Replaces the 100-message heartbeat entirely
- No gateway changes (interim outputs already supported)
- `<status>` inside `<think>` is silently dropped (think stripper runs first)
- Unclosed `<status>` tags treated as literal text (not stripped)

## What the user sees

```
⏳ searching facts for antenna models…
```

Followed by the final answer.
