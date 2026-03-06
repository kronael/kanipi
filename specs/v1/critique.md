# v1 spec consistency report — 2026-03-06

Systematic cross-check of all v1 specs against each other and
against code. Issues grouped by severity, then by subsystem.

## HIGH — spec contradicts code or specs contradict each other

### 1. Message history limits: spec says 30/2d, code has none

- `memory-messages.md:32` says "30 messages from the last 2 days"
- `db.ts:getMessagesSince()` returns ALL messages since cursor
- `formatMessages()` applies no count or time-window filter
- **Fix**: either implement the limit or update the spec

### 2. Session count: 3 vs 10

- `memory-session.md:76` says "Last 3 session IDs"
- `system-messages.md:84` says "last 10 sessions"
- `index.ts:252` calls `getRecentSessions(group.folder, 10)`
- **Fix**: update memory-session.md to say 10

### 3. Session table schema split

- `system-messages.md:73-81` describes one `sessions` table
- Code has two: `sessions` (current, keyed by group_folder)
  and `session_history` (historical records)
- **Fix**: update system-messages.md to document both tables

### 4. Socket path self-contradiction in isolation.md

- Lines 58-59: sidecar binds `/run/mcp.sock` (singular)
- Lines 133-135: docker mounts `/run/socks` (plural),
  env `MCP_SOCK=/run/socks/${spec.name}.sock`
- Code matches the plural/per-name version
- **Fix**: update prose in lines 36, 58-64 to match code

### 5. SidecarHandle fields outdated in isolation.md

- Spec line 141 returns `{ name, sockPath }`
- Code (`types.ts`) has `{ containerName, specName, sockPath,
allowedTools? }`
- **Fix**: update spec pseudocode

### 6. delegate_group IPC type name mismatch

- `group-routing.md:85` shows `"type": "delegate"`
- Code registers as `name: 'delegate_group'`
- Agent sending `"type": "delegate"` would fail
- **Fix**: update spec to say `delegate_group`

### 7. delegate_group missing chatJid in spec

- `group-routing.md:82-94` shows only `group` + `prompt`
- Code requires `chatJid: z.string().min(1)` too
- **Fix**: add chatJid to spec's IPC example

### 8. mime.md file layout vs code

- Spec: `src/enricher-pipeline.ts`, `src/enrichers/` directory
- Code: `src/mime-enricher.ts` (single file), enrichers in
  `src/mime-handlers/`
- **Fix**: update spec paths

### 9. prompt-format.md references removed paths

- Still says `/workspace/global/character.json`
- worlds.md migrated `global/` → `share/` in v0.4.0
- Code uses `share/`
- **Fix**: update prompt-format.md

### 10. prompt-format.md documents removed isMain field

- Spec shows `"isMain": true` in ContainerInput
- worlds.md replaced with `isRoot()`; code has neither
  `isMain` nor `isRoot` in ContainerInput
- **Fix**: remove from prompt-format.md

## MEDIUM — spec incomplete or missing cross-references

### 11. actions.md missing recent actions

- No mention of: `delegate_group`, `set_routing_rules`,
  `configure_sidecar`
- mcp-sidecar.md specifies `request_sidecar`, `stop_sidecar`,
  `list_sidecars` — also absent from actions.md
- **Fix**: add all new actions to actions.md

### 12. extend-agent.md doesn't reference sidecar model

- Only covers in-process MCP servers (settings.json)
- No mention of `request_sidecar` for isolated execution
- **Fix**: add cross-reference to mcp-sidecar.md

### 13. Inconsistent auth between static and dynamic routing

- Static routing: `isAuthorizedRoutingTarget()` checks
  same-world + direct parent-child explicitly
- Dynamic routing (`delegateGroup`): uses `startsWith`
  pattern — works but is implicit
- **Fix**: delegateGroup should call `isAuthorizedRoutingTarget`

### 14. Different error handling: static vs dynamic routing

- Static routing: logs warning, falls back to parent agent
- Dynamic routing: throws error
- Both are valid but should be documented as intentional

### 15. sync.md vs extend-skills.md path inconsistency

- sync.md says `data/sessions/<group>/skills/`
- extend-skills.md says `sessions/<group>/.claude/skills/`
- Code: `data/sessions/<group>/.claude/skills/`
- **Fix**: update sync.md

### 16. commands.md missing fields in CommandContext

- Spec: `{ group, message, channel, args }`
- Code adds: `groupJid`, `clearSession()`
- **Fix**: update spec

### 17. testing.md refers to nonexistent make target

- Spec: `make integration`
- Code: tests in `tests/e2e/`, run via `vitest run`
- Makefile has `make test` and `make smoke`, no `integration`
- **Fix**: update spec

### 18. pendingArgs injection order

- Specs show: system messages → message history
- Code inserts `pendingArgs` (command context) between them:
  `sysXml + pendingArgs + formatted`
- Not documented anywhere
- **Fix**: document in prompt-format.md

## LOW — stale text, minor gaps

### 19. ipc-signal.md doesn't mention sidecar IPC

- Sidecars use sockets, not the signal-based IPC
- Not wrong, but spec could note the scope boundary

### 20. channels.md uses colon JID prefix

- channels.md: `email:` prefix
- worlds.md future: `email/` prefix (Phase 2)
- Code: still uses colon — consistent with channels.md
- **Fix**: no action until Phase 2 ships

### 21. Diary feature fully specced, zero code

- memory-diary.md, memory-session.md, system-messages.md
  all reference diary injection
- No diary code exists
- Already tracked as open in todo.md
- **Fix**: no action (known open spec)

### 22. email.md sender identity format unclear

- Documents `sender = "email:user@example.com"` in some
  places, thread_id in others
- Minor: clarify which field is which

## Summary

| Severity | Count | Key areas                                             |
| -------- | ----- | ----------------------------------------------------- |
| HIGH     | 10    | message limits, session schema, socket paths, routing |
| MEDIUM   | 8     | missing action docs, cross-refs, auth inconsistency   |
| LOW      | 4     | stale text, unimplemented features                    |

## Suggested fix order

1. Fix HIGH #1 (message limits) — decide: implement or update spec
2. Fix HIGH #2-3 (session count/schema) — spec-only updates
3. Fix HIGH #4-5 (isolation.md) — spec-only updates
4. Fix HIGH #6-7 (delegate_group) — spec-only updates
5. Fix HIGH #8-10 (stale paths) — spec-only updates
6. Fix MEDIUM #11 (actions.md) — add new actions
7. Fix MEDIUM #13 (delegateGroup should use isAuthorizedRoutingTarget)
8. Remaining MEDIUM/LOW — batch spec updates
