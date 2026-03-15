---
status: open
---

# Subsystem Resilience

Every long-running loop and poller must either recover or crash.
Silent death is never acceptable.

## Rule

If a subsystem's polling/event loop fails:

1. Log an ERROR with subsystem name
2. Attempt recovery (reconnect, restart loop) with backoff
3. If recovery fails N times, crash the process (let systemd restart)

No subsystem should silently stop working while the process stays alive.

## Current Status

### Good (has recovery)

- **Email IMAP** (`email.ts`) — exponential backoff in `idleLoop()`,
  reconnects on failure, caps at 60s
- **Scheduler** (`task-scheduler.ts`) — try-catch continues loop,
  setTimeout fires unconditionally

### Needs Fix

- **Telegram polling** (`telegram.ts:396-411`) — `bot.start()` runs
  grammy's long-polling loop. No error handler for polling failures.
  409 Conflict (from competing getUpdates) kills polling silently.
  `bot.catch()` only covers middleware errors, not the transport.
  Fix: listen for grammy's polling error events, reconnect or crash.

- **Discord client** (`discord.ts:33-57`) — no `error` or `disconnect`
  handlers. discord.js auto-reconnects but if that exhausts retries,
  the client dies silently. Fix: add `client.on('error')` and
  `client.on('disconnect')` handlers.

- **WhatsApp reconnection** (`whatsapp.ts:116-144`) — first reconnect
  works (recursive `connectInternal()` with backoff). But cascading
  failures after 2 rejects leave system dead. `setInterval` for group
  sync leaks on repeated reconnection. Fix: clear interval on
  disconnect, add max-retry crash.

- **IPC watcher** (`ipc.ts:364-387`) — `pollForNewGroups()` has a
  try-catch that swallows errors silently. If `scanGroupFolders()`
  throws before the next `setTimeout`, polling stops. Fix: ensure
  setTimeout fires in a finally block.

## Implementation

For each subsystem, the pattern is:

```typescript
let failures = 0;
const MAX_FAILURES = 5;

function loop() {
  try {
    // ... poll/connect ...
    failures = 0;
  } catch (err) {
    failures++;
    logger.error({ err, failures }, 'Subsystem X failed');
    if (failures >= MAX_FAILURES) {
      logger.fatal('Subsystem X: max retries, crashing');
      process.exit(1);
    }
    setTimeout(loop, Math.min(1000 * 2 ** failures, 60000));
  }
}
```

## Related

- `3/5-permissions.md` — tier model
- `1/4-channels.md` — channel interface
