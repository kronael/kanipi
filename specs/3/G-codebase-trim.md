# Codebase Trim

**Status**: spec

Identify and remove dead code, duplicates, and over-abstraction.
Estimated ~900 lines removable without behavior change.

## 1. Dead modules (~210 lines)

### ~~impulse.ts~~ — KEEP

Impulse is the event batching/weighting system for social
channels (verb-based accumulation, threshold flush). Not
yet wired but planned for social integrations (specs/3/).

### Legacy IPC drain (~120 lines)

`drainLegacyMessages()` and `drainLegacyTasks()` in `src/ipc.ts`
handle pre-request-response IPC format. No code generates this
format anymore. Delete both + related types.

## 2. container/CLAUDE.md duplication (~140 lines)

Lines 43-186 ("Development Wisdom", "Development Principles")
duplicate `~/.claude/CLAUDE.md` which is loaded by the SDK
automatically. Keep only group-specific sections (lines 1-41):
Group Chat, Soul, Greetings, Diary, Memory, Session Continuity,
Knowledge.

## 3. Test mock consolidation (~400 lines)

8 test files independently mock `./logger.js` and `./config.js`
with nearly identical boilerplate. Extract shared mocks:

```
src/test-helpers.ts
  mockLogger()    — vi.mock('./logger.js', ...)
  mockConfig()    — vi.mock('./config.js', ...) with defaults
  makeGroup()     — test GroupConfig factory
```

Files affected: container-runner.test, ipc.test, ipc-auth.test,
ipc-delegate.test, group-queue.test, slink.test, auth.test,
task-scheduler.test.

## 4. Test-only exports (~50 lines of noise)

`_prefixed` exports scattered across production modules:

| Module              | Exports                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| index.ts            | `_setGroups`, `_processGroupMessages`, `_pushChannel`, `_setLastMessageDate`, `_getLastAgentTimestamp`, `_delegateToChild`, `_clearTestState` |
| db.ts               | `_setRawGroupColumns`, `_setTestGroupRoute`                                                                                                   |
| config.ts           | `_overrideConfig`, `_resetConfig`                                                                                                             |
| container-runner.ts | `_spawnProcess`                                                                                                                               |
| task-scheduler.ts   | `_resetSchedulerLoopForTests`                                                                                                                 |
| slink.ts            | `_resetRateLimitBuckets`                                                                                                                      |

These leak test concerns into production. Move to test setup
files or use `vi.importActual` patterns.

## 5. Repetitive try-catch-unlink (~40 lines)

8 occurrences in `src/ipc.ts` of:

```typescript
try {
  fs.unlinkSync(filePath);
} catch (e: unknown) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}
```

Extract `unlinkSafe(path)` helper.

## 6. Trivial wrappers (~15 lines)

| Function              | Location         | Usage              | Action |
| --------------------- | ---------------- | ------------------ | ------ |
| `escapeXml()`         | router.ts:18     | 2 calls            | inline |
| `stripInternalTags()` | router.ts:54     | 2 calls            | inline |
| `worldOf()`           | permissions.ts:1 | 1 call             | inline |
| `routeOutbound()`     | router.ts:62     | 0 production calls | delete |

## 7. Stale spec cleanup (~50 lines)

| File                                 | Action                     |
| ------------------------------------ | -------------------------- |
| `specs/6/0-evangelist.md`            | Delete (superseded by 3/R) |
| `specs/5/0-agent-media-awareness.md` | Convert to migration       |
| Shipped specs "Open" sections        | Trim completed items       |

## 8. Unused container types (~3 lines)

`container/agent-runner/src/index.ts` ContainerInput has unused
optional fields: `assistantName`, `delegateDepth`, `messageCount`.
Remove from interface.

## Priority order

1. Dead modules (impulse) — safe, no dependents; legacy IPC shipped
2. container/CLAUDE.md trim — immediate agent quality win
3. Test consolidation — biggest line savings, improves DX
4. Test-only exports — cleaner production surface
5. ipc.ts patterns — minor cleanup
6. Spec housekeeping — documentation quality

## Non-goals

- Don't inline `permissionTier()` — used in 5 places, semantic
- Don't consolidate action-registry — clear separation of concerns
- Don't remove prototype/ — actively used by CLI bootstrap
