---
status: shipped
---

# IPC signal notification — shipped

Replace 500ms polling with signal-triggered reads.

## Problem

Agent container polls `/workspace/ipc/input/` every 500ms
via `setTimeout`. Adds latency and wastes CPU.

## Design

- **Gateway → agent**: After writing IPC file, gateway sends
  `docker kill --signal=SIGUSR1` to container. Agent wakes
  immediately, drains input dir. 500ms poll remains as fallback.
- **Agent → gateway**: `fs.watch()` (inotify on Linux) on the
  `requests/` dir. Zero latency, no CPU waste.

## Why SIGUSR1

- Standard Unix, no extra dependencies (~5ms)
- Node.js handles natively, doesn't interfere with shutdown signals
- Backwards compatible: old containers ignore SIGUSR1, old gateways
  just don't send it (agent falls back to polling)
