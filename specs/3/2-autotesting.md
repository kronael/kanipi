---
status: shipped
---

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

## Conventions

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
