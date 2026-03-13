---
status: shipped
---

# Codebase Trim

Identify and remove dead code, duplicates, and over-abstraction.

## 1. Dead modules — DONE

### ~~impulse.ts~~ — KEEP

Impulse is the event batching/weighting system for social
channels (verb-based accumulation, threshold flush). Not
yet wired but planned for social integrations (specs/3/).

### Legacy IPC drain — DONE (2026-03-12)

`drainLegacyMessages()` and `drainLegacyTasks()` deleted.
All IPC goes through `requests/` since v0.5.0.

## 2. container/CLAUDE.md duplication — DONE

Dev wisdom sections were already removed. File now contains
only agent-specific content: group chat behavior, soul,
greetings, diary, status updates, memory, session continuity,
knowledge, tools, environment, file delivery/receiving.

## 3. Test mock consolidation — DEFERRED

Audit found that logger mocks are similar but config mocks
are fundamentally different per test file (different keys,
different values, some use importOriginal, some don't).
A shared helper would either be too generic to save lines
or require a complex override system. Not mechanical.

`makeGroup()` factory exists in 3 files but with different
signatures and return shapes. Not consolidatable.

## 4. Test-only exports — DEFERRED

15+ `_prefixed` exports across 6 production modules. Removing
requires redesigning how tests access internal state (e.g.
clearing singletons, resetting global maps). This is a test
architecture decision, not a mechanical trim.

## 5. Repetitive try-catch-unlink — DONE (2026-03-12)

`unlinkSafe()` helper already extracted in `src/ipc.ts`.

## 6. Trivial wrappers — DONE / KEPT

| Function              | Status                                          |
| --------------------- | ----------------------------------------------- |
| `routeOutbound()`     | DONE — already deleted                          |
| `escapeXml()`         | KEEP — used 15+ times in router.ts, not trivial |
| `stripInternalTags()` | KEEP — used in 2 production + test files        |
| `worldOf()`           | KEEP — used in production (permissions.ts)      |

Original spec undercounted usage. These are genuine helpers.

## 7. Stale spec cleanup — DONE (2026-03-13)

| File                                 | Action                          |
| ------------------------------------ | ------------------------------- |
| `specs/6/0-evangelist.md`            | Deleted (superseded by 4/R)     |
| `specs/6/0-agent-media-awareness.md` | Deleted (shipped in CLAUDE.md)  |
| specs/index.md phase 6+ section      | Removed                         |
| CLAUDE.md, ROADMAP.md, specs SKILL   | Updated to remove specs/6/ refs |

## 8. Unused container types — DONE

`ContainerInput` in agent-runner already has only used fields:
`prompt`, `sessionId`, `groupFolder`, `chatJid`,
`isScheduledTask`, `secrets`. The fields `assistantName`,
`delegateDepth`, `messageCount` were already removed.

## Non-goals

- Don't inline `permissionTier()` — used in 5 places, semantic
- Don't consolidate action-registry — clear separation of concerns
- Don't remove prototype/ — actively used by CLI bootstrap
