# IPC signal notification — shipped

Replace 500ms polling with signal-triggered reads.

## Problem

Agent container polls `/workspace/ipc/input/` every 500ms
via `setTimeout`. This adds up to 500ms latency on every
follow-up message and wastes CPU spinning on empty dirs.

## Solution

After writing an IPC file, gateway sends SIGUSR1 to the
container. Agent wakes immediately and drains the input dir.

### Gateway side (sender)

After writing a file to `input/`:

```typescript
// group-queue.ts or ipc.ts
fs.writeFileSync(filePath, JSON.stringify(msg));
exec(`docker kill --signal=SIGUSR1 ${containerName}`);
```

`docker kill --signal=SIGUSR1` sends the signal to PID 1
inside the container — which is the agent-runner process.

### Agent side (receiver)

Replace `setTimeout` polling with signal-driven wakeup:

```typescript
const IPC_POLL_MS = 500; // fallback only

let wakeup: (() => void) | null = null;

process.on('SIGUSR1', () => {
  if (wakeup) wakeup();
});

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const check = () => {
      if (shouldClose()) {
        resolve(null);
        return;
      }
      const msgs = drainIpcInput();
      if (msgs.length > 0) {
        resolve(msgs.join('\n'));
        return;
      }
      // wait for signal or fallback timeout
      const timer = setTimeout(check, IPC_POLL_MS);
      wakeup = () => {
        clearTimeout(timer);
        check();
      };
    };
    check();
  });
}
```

Same pattern for `pollIpcDuringQuery`:

```typescript
const pollIpcDuringQuery = () => {
  if (!ipcPolling) return;
  if (shouldClose()) {
    closedDuringQuery = true;
    stream.end();
    ipcPolling = false;
    return;
  }
  const messages = drainIpcInput();
  for (const text of messages) stream.push(text);

  const timer = setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  wakeup = () => {
    clearTimeout(timer);
    pollIpcDuringQuery();
  };
};
pollIpcDuringQuery();
```

## Why SIGUSR1

- Standard Unix mechanism, no extra dependencies
- `docker kill --signal=SIGUSR1` is fast (~5ms)
- Node.js handles it natively (`process.on('SIGUSR1')`)
- Doesn't interfere with SIGTERM/SIGINT shutdown
- Fallback polling still works if signal is missed

## Files changed

- `container/agent-runner/src/index.ts` — add SIGUSR1
  handler, replace pure polling with signal+fallback
- `src/group-queue.ts` — send SIGUSR1 after writing IPC
  file (has containerName already)
- `src/ipc.ts` — send SIGUSR1 after writing task files

## Migration

Backwards compatible. Old containers without the handler
ignore SIGUSR1 (Node.js default is to ignore it). New
containers with old gateway just fall back to polling.

## Gateway side: inotify for agent→gateway

The gateway uses `fs.watch()` on the `requests/` dir.
Node's `fs.watch()` uses inotify on Linux — zero latency,
no CPU waste. A poll loop for new group folders is still
used as fallback (`IPC_POLL_INTERVAL`).

Same for watching `tasks/` responses if needed.

## v3 note

In the Go rewrite, gateway uses `fsnotify` on the host
side instead. But the container side still benefits from
SIGUSR1 since fsnotify doesn't work across Docker mount
boundaries reliably.
