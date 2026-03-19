# 041 — Status updates reset gateway idle timer

`<status>` blocks emitted in ANY assistant message (not just the final result)
now immediately flush to the gateway as interim updates. Each flush resets the
idle timeout clock.

## What changed

- Agent-runner emits `<status>` blocks from intermediate assistant messages
  in real time, not only from the final SDK result
- Gateway idle timeout increased from 30 → 60 minutes
- `~/.claude/CLAUDE.md` updated: send status at task start AND every ~50
  tool calls or ~20 minutes during long work

## What to do

Update your status habits:

- Emit one at the **start** of any multi-step task
- Emit one every ~50 tool calls or ~20 minutes during long work
- Keep each under 100 chars

```
<status>starting research on validator bonds…</status>
... (50 tool calls later) ...
<status>half done, synthesising results…</status>
... (done) ...
```

The gateway resets its idle timer on each status, preventing spurious
timeouts on long tasks. No structural changes needed — just be more liberal
with periodic status blocks during extended work.
