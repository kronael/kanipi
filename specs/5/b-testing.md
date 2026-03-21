---
status: reference
---

# Testing

## Test tiers

```
make test                 unit + e2e (vitest run src tests/e2e), <15s
vitest run src            unit only (mocked deps), <5s
vitest run tests/e2e      e2e only (real fs + in-memory DB), ~10s
make smoke                real instance, real API (SDK wiring only)
```

### Unit (`vitest run src`)

Vitest, mocked deps, no docker. Covers: message formatting,
DB ops (in-memory SQLite), IPC auth, command dispatch,
router glob, config parsing, folder validation.

### E2E (`vitest run tests/e2e`)

Real fs + in-memory SQLite + IPC file protocol. No docker,
no channel deps. Covers: IPC request/reply cycle, watcher-
driven drain, action dispatch, DB-backed handlers, auth.

### Smoke (`make smoke`)

Real instance, optional, manual, not in CI. Verify SDKs
work with real credentials — just send, check arrival.

## Existing unit test specs

- **web-proxy.test.ts**: routes, rate limiting, JWT, SSE,
  media_url, basic auth
- **whisper.test.ts**: AbortController at 30s
- **video.test.ts**: ffmpeg timeout at 60s
- **slink.test.ts**: media_url types, download validation
- **voice.test.ts**: video mimeType rejection
- **web.test.ts**: multi-group isolation, concurrent writes

## Testability seams (shipped)

- `db.ts`: `setDatabase()` for in-memory SQLite
- `config.ts`: `_overrideConfig()` / `_resetConfig()`
- `container-runner.ts`: `_spawnProcess` injectable spawn
- Channels: constructor injection deferred
