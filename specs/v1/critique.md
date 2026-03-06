# v1 spec consistency report — 2026-03-06

Systematic cross-check of all v1 specs against each other and
against code. Issues grouped by severity, then by subsystem.

Last audit: 2026-03-06 (all items resolved or deferred).

## HIGH — spec contradicts code or specs contradict each other

### 1. Message history limits: spec says 30/2d, code has none

- **FIXED**: spec updated to 100 messages (MSG_LIMIT), no time filter.
  Code matches at `db.ts:398`.

### 2. Session count: 3 vs 10

- **FIXED**: memory-session.md says 2, code uses 2.
  `index.ts:252` calls `getRecentSessions(group.folder, 2)`.

### 3. Session table schema split

- **FIXED**: system-messages.md documents both `sessions` and
  `session_history` tables.

### 4. Socket path self-contradiction in isolation.md

- **FIXED**: isolation.md correctly uses `/run/socks/<name>.sock`
  (plural, per-name). Code matches.

### 5. SidecarHandle fields outdated in isolation.md

- **FIXED**: isolation.md shows `{ containerName, specName, sockPath,
allowedTools }`. Matches `types.ts`.

### 6. delegate_group IPC type name mismatch

- **FIXED**: group-routing.md uses `"type": "delegate_group"`.
  Code registers as `name: 'delegate_group'`. Aligned.

### 7. delegate_group missing chatJid in spec

- **FIXED**: group-routing.md includes `chatJid` in both example
  and field table.

### 8. mime.md file layout vs code

- **FIXED**: spec correctly references `src/mime-enricher.ts` and
  `src/mime-handlers/`.

### 9. prompt-format.md references removed paths

- **FIXED**: spec uses `/workspace/share/character.json` (current).

### 10. prompt-format.md documents removed isMain field

- **FIXED**: spec omits `isMain` from ContainerInput. Field exists
  in InboundMessage (mime pipeline only) as expected.

## MEDIUM — spec incomplete or missing cross-references

### 11. actions.md missing recent actions

- **FIXED**: added sidecar actions (`request_sidecar`, `stop_sidecar`,
  `list_sidecars`) to actions.md under "Sidecars (specced, not yet
  implemented)" section.

### 12. extend-agent.md doesn't reference sidecar model

- **FIXED**: extend-agent.md line 60 cross-references mcp-sidecar.md
  and mentions `request_sidecar`. Sufficient for v1.

### 13. Inconsistent auth between static and dynamic routing

- **FIXED**: both static and dynamic routing now use
  `isAuthorizedRoutingTarget()`.

### 14. Different error handling: static vs dynamic routing

- **FIXED**: documented as intentional in group-routing.md.
  Static: warn + fallback. Dynamic: throw error.

### 15. sync.md vs extend-skills.md path inconsistency

- **FIXED**: both reference `.claude/skills/` correctly.

### 16. commands.md missing fields in CommandContext

- **FIXED**: CommandContext includes `groupJid` and `clearSession()`.

### 17. testing.md refers to nonexistent make target

- **FIXED**: replaced `make integration` with actual commands.
  E2E section documents `vitest run tests/e2e`. Integration
  (testcontainers) marked as future.

### 18. pendingArgs injection order

- **FIXED**: documented in prompt-format.md. Assembly order:
  system messages → pendingArgs → message history.

## LOW — stale text, minor gaps

### 19. ipc-signal.md doesn't mention sidecar IPC

- **DEFERRED**: sidecars use sockets (different transport).
  ipc-signal.md scope is file-based IPC only.

### 20. channels.md uses colon JID prefix

- **DEFERRED**: code uses colon (`email:`). Consistent.
  Slash prefix is worlds.md Phase 2 (v2).

### 21. Diary feature fully specced, zero code

- **OPEN**: memory-diary.md complete. No code yet.
  Primary open v1 feature.

### 22. email.md sender identity format unclear

- **DEFERRED**: minor. `sender = "email:user@example.com"` is
  consistent with code. No action needed.

## Summary

| Status   | Count |
| -------- | ----- |
| FIXED    | 18    |
| DEFERRED | 3     |
| OPEN     | 1     |
