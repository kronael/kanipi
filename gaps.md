# Spec Audit Gaps

Audit date: 2026-03-07

Scope:

- `specs/1/*`
- `specs/2/*`
- implementation under `src/`, `container/`, `kanipi`
- top-level docs (`README.md`, `ARCHITECTURE.md`)

Status key:

- `shipped`: implemented and evidenced in code/tests
- `partial`: some implementation exists, but spec scope is not fully shipped
- `open`: not implemented
- `reference`: documentation/research spec, not a shipped feature

## Important Facts

- The implementation is materially ahead of some older docs, but several docs
  still overstate planned features as shipped.
- Local web auth is implemented; OAuth providers are not.
- Hierarchical child-group routing is implemented; glob-based JID routing is
  not evidenced in current `src/`.
- Session continuity, system-message injection, task scheduling, slink, and
  request/reply IPC are implemented.
- Sidecars are only partially shipped: gateway-managed sidecars exist, but the
  agent-requested lifecycle/actions in the spec are not wired.
- The permission model exists in code, but does not match the full phase 2
  `permissions.md` design.
- SSE works today, but it broadcasts per group and does not scope by sender.
- `work.md`, session recovery notes, web virtual hosts, facts memory, and most
  phase 2 design work are not shipped.

## v1 Audit

| Spec                   | Status    | Notes                                                                                                                                                                                                                                                                            |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------- |
| `README.md`            | partial   | Useful index, but status labels rely on stale `todo.md`; `sidecars` is listed as partial, `router/channels` are documentation-only, and some status claims are broader than code evidence.                                                                                       |
| `actions.md`           | shipped   | Action registry, Zod validation, manifest, and request/reply IPC are implemented in `src/action-registry.ts`, `src/ipc.ts`, and `src/actions/*`.                                                                                                                                 |
| `agent-routing.md`     | open      | Worker-agents-within-a-group model is not implemented.                                                                                                                                                                                                                           |
| `auth.md`              | partial   | Local auth is shipped in `src/auth.ts` and `src/web-proxy.ts`; OAuth providers, provider routes, and the broader provider matrix are not implemented. Cookie path/security details in spec do not match code exactly.                                                            |
| `channels.md`          | partial   | Channel abstraction exists, but spec examples are stale: Telegram JIDs are migrated to `telegram:` in DB, and WhatsApp is wrapped as `whatsapp:` in code.                                                                                                                        |
| `cli.md`               | partial   | Bash CLI ships; TypeScript rewrite does not.                                                                                                                                                                                                                                     |
| `commands.md`          | partial   | `/new`, `/ping`, `/chatid`, `/stop`, and file commands ship, but the spec is marked open and discusses native command registration beyond what is evidenced here.                                                                                                                |
| `db-bootstrap.md`      | open      | No versioned SQL migration system; schema still uses inline `ALTER TABLE ... try/catch` in `src/db.ts`.                                                                                                                                                                          |
| `email.md`             | shipped   | IMAP/SMTP channel and thread mapping are implemented.                                                                                                                                                                                                                            |
| `extend-agent.md`      | shipped   | Agent-managed `settings.json` is merged with gateway MCP config in `src/container-runner.ts`.                                                                                                                                                                                    |
| `extend-gateway.md`    | reference | Architecture/reference doc.                                                                                                                                                                                                                                                      |
| `extend-skills.md`     | shipped   | Skill seeding and migration versioning are implemented in container/session setup.                                                                                                                                                                                               |
| `file-output.md`       | shipped   | `send_file` action ships; channel document sending exists where supported.                                                                                                                                                                                                       |
| `files-in.md`          | partial   | File transfer exists, but command surface is `/file put                                                                                                                                                                                                                          | get | list`rather than the older`/put`, `/get`, `/ls` framing in the spec. |
| `forward-metadata.md`  | shipped   | Forwarded-from and reply-to metadata are stored and rendered into XML.                                                                                                                                                                                                           |
| `group-routing.md`     | shipped   | Parent/child routing rules, `delegate_group`, authorization checks, and DB fields are implemented.                                                                                                                                                                               |
| `introspection.md`     | shipped   | `.gateway-caps` writing and `.whisper-language` reading are implemented in `src/container-runner.ts`.                                                                                                                                                                            |
| `ipc-signal.md`        | shipped   | Signal-driven wakeups are implemented in the runner path.                                                                                                                                                                                                                        |
| `memory-diary.md`      | shipped   | Diary support exists and is injected into prompts.                                                                                                                                                                                                                               |
| `memory-managed.md`    | shipped   | Persistent Claude memory/session dirs are mounted and preserved.                                                                                                                                                                                                                 |
| `memory-messages.md`   | shipped   | XML message formatting and recent-history injection are implemented.                                                                                                                                                                                                             |
| `memory-session.md`    | shipped   | Session IDs, session history, rollback/error handling, and `/new` reset flow are implemented despite the spec header still saying open.                                                                                                                                          |
| `mime.md`              | partial   | Voice/video/document enrichment exists, but the broader aspirational pipeline in the spec is not fully implemented.                                                                                                                                                              |
| `plugins.md`           | open      | No operator approval/plugin proposal pipeline in code.                                                                                                                                                                                                                           |
| `prompt-format.md`     | shipped   | Current container input/output shape matches implementation closely.                                                                                                                                                                                                             |
| `reference-systems.md` | reference | Research/reference doc.                                                                                                                                                                                                                                                          |
| `router.md`            | partial   | High-level flow is correct, but it still references worlds/glob behavior more broadly than current code evidence supports.                                                                                                                                                       |
| `sidecars.md`          | partial   | Gateway-managed sidecars are implemented; agent-requested sidecars/actions are not.                                                                                                                                                                                              |
| `slink.md`             | shipped   | Tokenized web POST endpoint, auth-aware rate limits, and media URL handling ship.                                                                                                                                                                                                |
| `sync.md`              | shipped   | Skill migration/version flow exists.                                                                                                                                                                                                                                             |
| `system-messages.md`   | shipped   | DB-backed queued system messages and flush-before-prompt behavior ship.                                                                                                                                                                                                          |
| `task-scheduler.md`    | shipped   | DB-backed cron/interval/once tasks and task CRUD actions ship.                                                                                                                                                                                                                   |
| `testing.md`           | shipped   | Unit and e2e coverage are real; smoke is still a separate Docker-dependent tier.                                                                                                                                                                                                 |
| `todo.md`              | partial   | Good as a rough tracker, but stale in several places: `memory-session` is marked shipped in summary but its spec file still says open; `isolation` points to a spec name that does not exist under `specs/1/`; and some shipped/open labels no longer line up with current docs. |
| `voice.md`             | open      | This spec describes an older Telegram-specific transcription path that is not how the current gateway works. Current transcription is via the generic MIME/whisper pipeline.                                                                                                     |
| `worlds.md`            | partial   | JID normalization and world-style folder reasoning exist, but glob routing and some later-phase behavior are not evidenced in current code.                                                                                                                                      |

## v1 Gaps To Fix Later

- Align `specs/1/3-auth.md` with the actual shipped scope: local auth only.
- Either implement or de-scope glob routing claims in `specs/1/e-worlds.md`
  and derivative docs.
- Rewrite `specs/1/d-voice.md` to describe the actual MIME/whisper path.
- Split `commands/files-in` docs between shipped file commands and older draft
  naming.
- Rename or reconcile `isolation` vs `sidecars` references in `todo.md`.

## Phase 2 Audit

| Spec                       | Status    | Notes                                                                                                                                                                                                        |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-capabilities.md`    | partial   | Useful design note, but some container claims are stale. The agent container has Chromium, curl, git, bun, and Claude Code; it does not currently include `ffmpeg` or `yt-dlp`.                              |
| `autotesting.md`           | partial   | Large parts are already true, but some proposed tests still do not exist (`src/ipc.test.ts`, dedicated voice roundtrip e2e).                                                                                 |
| `memory-facts.md`          | open      | Facts memory is explicitly deferred; no implementation.                                                                                                                                                      |
| `paths.md`                 | partial   | The noisy `ENOENT` unlink issue is fixed in request handling, but `hostPath()` still exists and the broader explicit-host-path refactor is not done.                                                         |
| `permissions.md`           | partial   | Permission tiers and mount restrictions exist, but the full spec is not shipped. Root is not limited to folder name `root`; upward delegation is not implemented; some tier semantics differ from spec text. |
| `session-recovery.md`      | open      | No evidence of recovery-note storage/injection in `src/index.ts` or runner flow.                                                                                                                             |
| `sse.md`                   | partial   | SSE exists today, but it is the insecure broadcast model described in the problem statement; sender-scoped SSE is not implemented.                                                                           |
| `web-virtual-hosts.md`     | open      | No `web_host` column, host-based per-group serving, or corresponding actions.                                                                                                                                |
| `whatsapp-improvements.md` | open      | This is a design/backlog note. Current code still sends `available` presence on connect and still swallows read-receipt errors.                                                                              |
| `work.md`                  | open      | No gateway injection or lifecycle around `work.md`.                                                                                                                                                          |
| `worlds-rooms.md`          | reference | Research/reference doc.                                                                                                                                                                                      |

## Phase 2 Gaps To Fix Later

- Decide whether `permissions.md` should be updated to current behavior first,
  or whether code should be pushed toward the stricter model.
- Implement sender-scoped SSE or clearly document current broadcast semantics.
- Implement or defer path-translation cleanup formally; current state is mixed.
- Add the missing regression tests called out in `autotesting.md`.

## Docs Corrected In This Pass

- `README.md`
  - clarified Atlas `facts/` as planned rather than shipped
  - documented that `/_sloth/stream` currently broadcasts per group
  - documented auth as local auth only, not OAuth
  - documented child-group routing without claiming glob-based JID routing

## Highest-Value Code Gaps

1. OAuth and provider-based auth remain unimplemented despite broad auth docs.
2. Sender-scoped SSE is missing; current stream model can leak replies across
   listeners on the same group.
3. Sidecar actions/lifecycle are only half shipped.
4. Versioned DB migrations are still missing.
5. Session recovery notes and `work.md` are not implemented.
6. The permission model and docs are not yet aligned.
