---
status: shipped
---

# Path translation spec (v2) — shipped

## Problem

Gateway runs in Docker, spawns child containers via host Docker daemon.
Gateway-internal paths must be translated to host-side paths for child
mounts. Previously solved with three overlapping mechanisms (`hostPath()`
string replace, `HOST_GROUPS_DIR` explicit, `DATA_DIR` implicit).

## Design

Replace all path translation with explicit `HOST_*` exports computed
once at startup: `HOST_DATA_DIR`, `HOST_GROUPS_DIR`, `HOST_APP_DIR`.
Each mount path constructed explicitly from these constants — no string
replacement. `hostPath()` and `GATEWAY_ROOT` deleted.

## Where

- `src/config.ts` — `detectHostPath()`, `HOST_*` exports
- `src/container-runner.ts` — mount path construction using `HOST_*`
