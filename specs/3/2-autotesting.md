# autotesting — subsystem test strategy

## Tiers

**Unit** (`src/*.test.ts`) — no I/O, <1s each. Mock at system
boundaries (fetch, spawn, fs.watch). In-memory SQLite via
`_initTestDatabase()` counts as real.

**Integration** (`tests/e2e/*.test.ts`) — wire real modules. Mock
docker/channels/external I/O. Real DB, GroupQueue, enricher, formatting.

**Smoke** (`tests/smoke/`, `tests/integration/`) — requires docker.
Real containers, actual IPC round-trip. Run before releases only.

`make test` runs unit + integration (<12s). `make smoke` for docker tests.

## Coverage status

### Fully tested (46 files)

| Subsystem                                                                  | Test file(s)                                                           | Tests |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| DB + migrations                                                            | `db.test.ts`                                                           | 42    |
| Routing + formatting                                                       | `routing.test.ts`, `formatting.test.ts`                                | 90    |
| IPC dispatch + watcher                                                     | `ipc.test.ts`, `ipc-auth.test.ts`, `ipc-delegate.test.ts`              | 63    |
| Action registry                                                            | `action-registry.test.ts`, `tests/e2e/action-registry.test.ts`         | 20    |
| Actions (all)                                                              | `actions/{groups,social,session,inject,messaging,tasks}.test.ts`       | 78    |
| Commands (all)                                                             | `commands/{index,ping,chatid,new,file,stop}.test.ts`                   | 33    |
| Container runner/runtime                                                   | `container-runner.test.ts`, `container-runtime.test.ts`                | 20    |
| Group queue                                                                | `group-queue.test.ts`                                                  | 12    |
| MIME + enricher + handlers                                                 | `mime.test.ts`, `mime-enricher.test.ts`, `mime-handlers/*.test.ts`     | 40    |
| Security                                                                   | `mount-security.test.ts`, `auth.test.ts`, `permissions.test.ts`        | 54    |
| Config/env                                                                 | `config.test.ts`, `env.test.ts`                                        | 16    |
| Other (slink, diary, impulse, web-proxy, task-scheduler, agent-runner-fns) | various                                                                | 87+   |
| Channels                                                                   | `whatsapp.test.ts`, `web.test.ts`                                      | 49    |
| E2E                                                                        | `tests/e2e/{message-loop,container-runner,ipc-watcher,ipc-fs}.test.ts` | 51    |

### Intentionally untested

These modules are not unit-testable or not worth testing in isolation:

- `index.ts` — main loop orchestration (tested via e2e/message-loop)
- `cli.ts` — CLI entrypoint, thin wrapper
- `logger.ts` — pino config, no logic
- `types.ts` — type definitions only
- `migrations.ts` — exercised transitively by every test that calls `_initTestDatabase()`
- `whatsapp-auth.ts` — external auth flow
- `channels/{telegram,discord,email}.ts` — external SDK wrappers
- `channels/{reddit,twitter,mastodon,bluesky,facebook}/**` — social channel adapters (external APIs)

## Test design principles

- Test the feature, not the fix
- Mock only at system boundaries
- Fake timers for timeout/race scenarios (`vi.useFakeTimers`)
- One test file per source module, colocated
- Config mocks: use `vi.mock('./config.js', () => ({...}))` with only needed exports
- Logger mocks: always include `{ info, warn, debug, error }` stubs

## Adding new tests

1. Create `src/foo.test.ts` next to `src/foo.ts`
2. Mock `config.js` and `logger.js` if the module imports them
3. Use `_initTestDatabase()` in `beforeEach` for DB-dependent tests
4. Integration tests spanning multiple modules go in `tests/e2e/`
5. Run `make test` — must stay under 15s total
