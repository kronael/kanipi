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

### Integration (future — testcontainers)

Full gateway with mock agent via testcontainers. One image,
vitest manages lifecycle, no compose. Not yet implemented;
no Makefile target.

**Setup**: testcontainers starts gateway, gateway spawns
mock-agent containers via docker socket.

```typescript
gateway = await new GenericContainer('kanipi:latest')
  .withEnvironment({
    CONTAINER_IMAGE: 'kanipi-mock-agent:latest',
    SLINK_ENABLED: '1',
  })
  .withBindMounts([
    {
      source: '/var/run/docker.sock',
      target: '/var/run/docker.sock',
    },
  ])
  .withExposedPorts(3000)
  .withWaitStrategy(Wait.forHttp('/health', 3000))
  .start();
```

**Mock agent**: reads stdin JSON, pattern-matches prompt
keyword, returns canned response. Deterministic.

Build: `make mock-agent-image`

**Scenarios**:

- Message round-trip (POST -> agent -> SSE response)
- Threading (inbound `<in_reply_to>`, outbound replyTo)
- System messages (new-session, new-day injection)
- Commands (/new, /ping, /chatid)
- Error retry (error notification, cursor rollback)
- IPC message send (cross-group delivery)
- IPC reset_session
- Task scheduling (create, fast-forward, execute)
- Glob routing (pattern JID -> correct group)
- Share mount (read/write permissions)
- Multi-group routing (isolation)
- IPC file send + path safety
- IPC auth (non-root blocked, root allowed)
- IPC group registration + refresh (root only)
- Trigger mode (skip without trigger, dispatch with)
- Container lifecycle (spawn, idle timeout, re-spawn)
- Concurrent containers (MAX_CONCURRENT respected)
- Mime enrichment (whisper annotation)
- IPC task CRUD (create/pause/resume/cancel, auth)
- Agent crash (exit 1 -> error notification)
- Agent timeout (hang -> kill -> error)
- Empty/null output (no message sent)
- Large output (truncation)
- File output (persist across restarts)
- IPC file path escape (blocked)
- Session recording (DB rows, previous_session injection)
- Session history across gateway restarts
- Group queue ordering + isolation
- Stdin piping (mid-session messages)
- Bot message filtering
- Message formatting (XML escaping, `<internal>` strip)
- Command not found (dispatched as normal text)
- Slink rate limiting + auth
- Chat metadata storage
- Whisper language config
- SDK hookings (slink as test channel)
- Compaction / diary (future)

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
