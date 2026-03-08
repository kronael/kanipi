# Changelog

All notable changes to kanipi are documented here.

kanipi is a fork of [nanoclaw](https://github.com/nicholasgasior/nanoclaw)
(upstream at v1.1.3).

---

## [Unreleased]

---

## [v1.0.8] — 2026-03-08

### Features

- IPC and action-registry test coverage: 16 new tests (drainRequests dispatch, schema validation, path traversal, manifest filtering)
- Total: 521 tests across 36 files

---

## [v1.0.7] — 2026-03-08

### Features

- Production JSON logging: pino outputs JSON when `NODE_ENV=production`, pino-pretty for dev
- Trace IDs: `traceId` and `dur` (ms) fields in message processing logs for end-to-end traceability
- IPC request timing at debug level
- PREFIX semantic: all paths derive from `PREFIX` env var (default `/srv`), no hardcoded paths
- Rich `.env.example` documenting all config flags with comments
- Agent media awareness: CLAUDE.md teaches agents to Read PDFs/images, use voice transcription text

### Changes

- `inject_message` action: insert messages into DB without channel delivery (root/world only), clears errored flag — enables programmatic retry after OOM kills
- README: prerequisites, both deployment paths (docker + standalone), troubleshooting, WhatsApp setup, architecture overview
- Dev script changed from bun to tsx for consistency

---

## [v1.0.6] — 2026-03-07

### Features

- TypeScript CLI rewrite: `src/cli.ts` replaces bash `kanipi` entrypoint for group/user/mount commands
- Versioned SQL migrations: `src/migrations.ts` + `src/migrations/*.sql` files, tracked in DB `migrations` table
- Integration tests with testcontainers: `tests/integration/` runs real agent containers with scenario mode

### Changes

- Agent-runner scenario mode: `NANOCLAW_SCENARIO` env var returns canned responses for deterministic tests
- `ensureDatabase()` replaces `initDatabase()` — shared by gateway and CLI, no more inline DDL in bash

---

## [v1.0.5] — 2026-03-07

### Changes

- Cross-channel routing fix: idle containers preempted when a different channel needs the same folder
- WhatsApp markdown conversion: `**bold**` to `*bold*`, `~~strike~~` to `~strike~`
- WhatsApp read receipts: messages marked as read (blue ticks)
- Orphaned container cleanup: containers closed when group is unregistered via CLI
- Extracted `releaseGroup()` helper in group-queue for cleaner state cleanup

---

## [v1.0.4] — 2026-03-07

### Changes

- WhatsApp /chatid: respond from unregistered chats (like Telegram)
- Multi-JID groups: multiple channel JIDs can share one folder
- Permission tiers: tier-based authorization for IPC actions and mounts
- Howto skill: WhatsApp setup instructions, 3-level guide structure

---

## [v1.0.3] — 2026-03-07

### Changes

- WEB_PUBLIC mode: skip auth and /pub/ redirect for public-facing instances
- Group web prefix: skills publish under group-specific web dirs
- Skills updated: hello (capability levels, group-aware links), howto (3-level
  guide: beginner/intermediate/advanced), web (group prefix convention),
  research (group-aware deploy)
- Migration 015: group web prefix convention
- Fix docs path: kanipi.html deployment path corrected (removed stale /pub/)
- Permission tiers spec: 4-tier hierarchy (root/world/agent/worker)
- Specs v1 architecture: 37 specs organized by concern with dependency diagram
- Spec merges: auth (local+oauth), sidecars (isolation+mcp), files-in rename
- Escalation spec (v2m1): upward delegation protocol
- Prototypes spec (v2m1): per-JID group spawning from templates
- Task scheduler spec: documented shipped task scheduler

---

## [v1.0.2] — 2026-03-07

### Changes

- Don't auto-retry errored messages on startup (errored flag in chats table)
- Startup protocol in CLAUDE.md (get context before acting)
- Core design facts documented (Claude Code runtime, memory is Claude-centric)
- README.md: principles manifesto (fast ecosystem, modularity as survival)
- ROADMAP.md: v1/v2/v3 progression
- Products defined: Atlas (support), Yonder (research), Evangelist, Cheerleader
- Atlas v2 spec: sandboxed support agent (frontend/backend split)
- Specs reorganized: v1m1/v1m2/v2m1/v2m2 versioned milestones
- Global specs skill for spec-driven development workflow

---

## [v1.0.1] — 2026-03-06

### Changes

- Replaced character.json with SOUL.md persona (zero code in agent-runner)
- Agent personality via CLAUDE.md instruction to read SOUL.md on new sessions
- Removed ~100 lines from agent-runner (Character interface, shuffle,
  assembleCharacter, loadCharacter, loadSoul)
- Per-channel output styles: telegram, discord, email, web (SDK native feature)
- Gateway threads channel name into container settings for style activation
- `/stop` command: gracefully stop running agent container
- Hello skill reads SOUL.md persona instead of hardcoded intro
- Migration 013: updates seeded CLAUDE.md with Soul/Knowledge/Greetings sections

---

## [v1.0.0] — 2026-03-06

V1 release. All planned features shipped: 5 channels, group routing,
action registry, MCP sidecars, diary memory, forward metadata, file
commands, capability introspection, security hardening. 40 source files,
9,278 LOC + 27 test files, 7,809 LOC.

### Changes

- Version bump to 1.0.0 (no code changes from v0.7.0)
- Spec hardening: memory-messages, isolation, actions, testing,
  prompt-format, mime specs updated for accuracy
- Updated docs and product page

---

## [v0.7.0] — 2026-03-06

### Features

- Forward metadata: forwarded message origin and reply-to context
  extracted per channel (Telegram, WhatsApp, Discord), rendered as
  nested XML tags in agent prompt
- Diary injection: gateway reads diary/\*.md files and injects 2 most
  recent summaries into agent prompt on session start
- Diary nudge: PreCompact hook nudges agent to write diary entry before
  context compression
- Gateway capabilities manifest: .gateway-caps TOML file written before
  each agent spawn (voice, video, media, web capability state)
- File commands: /put, /get, /ls for bidirectional file transfer between
  chat users and group workspace (disabled by default)
- JID normalization: `kanipi group add` normalizes telegram:/whatsapp:
  prefixes to match runtime format

### Fixes

- Diary XML format matched to knowledge system spec
- Calendar-day diff bug in diary age labels
- Forward metadata: reply context no longer dropped when sender missing
- Telegram: null chat/channel title safety in forward extraction
- File commands: symlink escape protection, --force flag parsing
- Gateway-caps: whisper model field, sanitized language values

---

## [v0.6.3] — 2026-03-06

### Features

- Media-aware file sending: telegram routes photos/videos/audio/animations
  to native API methods (inline display); whatsapp routes by MIME type
- Diary spec: Stop hook nudge after 100 turns, task tracking in entries,
  terse summary format

### Fixes

- Replace agent error retry loop with circuit breaker (manual retry only,
  warns after 3 consecutive failures per group)
- Telegram: removed dead `method` variable in sendDocument

---

## [v0.6.2] — 2026-03-06

### Features

- Telegram: images (PNG/JPG/GIF/WEBP) sent via `sendPhoto` for inline
  display instead of `sendDocument` (file attachment)

### Fixes

- Agent CLAUDE.md: `send_file` no longer prompts follow-up text description

---

## [v0.6.1] — 2026-03-06

### Fixes

- Container stop: `exec()` → `execFileSync`/`spawn` (no shell anywhere)
- Command handlers: `await` instead of fire-and-forget (race condition)
- Cursor rollback: restore cursor on agent error when no output was sent
  (previousCursor was saved but never used — messages in DB but invisible)
- Routing schema: `.max(200)` on pattern/sender Zod fields (was only
  enforced at runtime, silent failure)
- Sidecar socket cleanup: catch only ENOENT (was `catch {}`)
- Agent container: use `bunx tsc` for build, validate-only compile step

---

## [v0.6.0] — 2026-03-06

### Fixes

- IPC: catch only ENOENT on file cleanup (was swallowing all errors)
- IPC: validate envelope id/type fields, reject malformed requests
- IPC: delete failed files instead of accumulating in errors/ dir
- Routing: cap regex pattern length at 200 chars (ReDoS mitigation)
- Config: validate TIMEZONE via Intl.DateTimeFormat, fallback to UTC
- Sidecar: use spawn() instead of exec() for lifecycle (shell injection fix)

### Features

- **Hierarchical group routing**: parent groups delegate to children via
  routing rules (command, pattern, keyword, sender, default). Authorization
  enforces same-world, direct parent-child only. Max delegation depth 3.
- **Sidecar isolation**: per-group MCP sidecars via `SIDECAR_<NAME>_IMAGE`
  env vars. Socket transport at `/workspace/ipc/sidecars/<name>.sock`.
  Gateway manages lifecycle (start, probe, reconcile settings, stop).
- **Action input validation**: Zod schemas on all actions; malformed
  IPC requests rejected with typed error replies.
- **New actions**: `delegate_group`, `set_routing_rules`
- **Session history**: `session_history` table replaces `sessions`;
  new-session injection includes last 2 previous sessions

---

## [v0.5.0] — 2026-03-06

### Features

- **Action registry**: unified action system — all IPC handlers, MCP
  tools, and commands reference a single `Action` interface with typed
  Zod schemas and authorization. `src/action-registry.ts` + `src/actions/`
- **Request-response IPC**: agents write to `requests/`, poll `replies/`.
  Gateway dispatches through action registry and writes typed replies.
  Fire-and-forget IPC retained for backwards compat during rollout.
- **Tool discovery**: gateway writes `action_manifest.json` at spawn
  time. Agent MCP server reads manifest for dynamic tool registration.
- **Agent MCP self-registration**: agent-written `mcpServers` in
  `settings.json` are merged with built-in `nanoclaw` server.
  Dynamic `allowedTools` includes `mcp__<name>__*` wildcards.
- **Message threading types**: `SendOpts { replyTo }` on Channel
  interface, `replyTo` field on `NewMessage`

### Breaking

- `processTaskIpc` moved from `ipc.ts` to `ipc-compat.ts`
- IPC handlers refactored into `src/actions/` modules

---

## [v0.4.0] — 2026-03-06

### Breaking

- `NANOCLAW_IS_MAIN` env var → `NANOCLAW_IS_ROOT`
- `/workspace/global` mount → `/workspace/share`
- `isMain` removed from `ContainerInput` interface

### Changes

- `isMain` → `isRoot(folder)` — structural check (`!folder.includes('/')`)
  replaces hardcoded `MAIN_GROUP_FOLDER = 'main'` comparison
- `groups/global/` → `groups/<world>/share/` — shared state lives inside
  world root, always mounted (rw for root, ro for children)
- Folder validation allows `/` separator for future hierarchy
- Reserved folder `global` → `share`

---

## [v0.3.0] — 2026-03-06

### Features

- **System messages**: `system_messages` and `sessions` DB tables. Gateway
  enqueues context annotations (new-session history, new-day marker, command
  context) and flushes them as XML before user messages in agent stdin.
- **Session recording**: every container spawn/exit recorded in `sessions`
  table with timing, message count, result, and error. New-session injection
  includes last 2 previous sessions as `<previous_session>` XML elements.
- **Command registry** (`src/commands/`): pluggable handlers replace
  hardcoded telegram commands. `/new` (session reset with continuity),
  `/ping`, `/chatid` shipped. Commands intercepted in message loop before
  agent routing.
- **`reset_session` IPC**: agent can clear its own session via IPC message.
- **Error notification**: on agent error, user receives retry prompt and
  message cursor rolls back. If output was already sent, cursor is preserved
  to prevent duplicate delivery.
- **Agent SKILL.md**: documents system message origins, session history
  access (`~/.claude/projects/`), group configuration files, whisper
  language config. Migrations 005-007.
- **agent-runner CLAUDE.md**: session layout documentation for in-container
  agent.

### Fixes

- System message format corrected (origin+event attributes, no colon).
- Voice transcription label now `[voice/auto→en: ...]` (was `[voice: ...]`).

---

## [v0.2.8] — 2026-03-05

### Features

- Agent self-skill documents session history access (`~/.claude/projects/`)
  and `.whisper-language` group configuration file.
- Migration 005: whisper language config docs. Migration 006: session history.

### Fixes

- System message format corrected in specs/SKILL.md (origin+event, no colon).
- Voice transcription label now `[voice/auto→en: ...]` (was `[voice: ...]`).

---

## [v0.2.7] — 2026-03-05

### Fixes

- **Voice transcription in active sessions**: second voice message in a
  running container session was missing transcription. Root cause: message
  objects fetched before `waitForEnrichments`, then used stale after wait.
  Both dispatch paths (new container + stdin pipe) now re-fetch from DB
  after enrichment completes, so voice/video content is always included.
- IPC drain race: concurrent `drainGroupMessages` calls for same group
  caused duplicate file sends. Fixed with per-group boolean lock.

### Features

- Whisper large-v3 model for better multilingual accuracy.
- Per-group language configuration via `.whisper-language` file.
- Parallel transcription passes: auto-detect + each configured language.
  Output labeled `[voice/auto→{detected}]` or `[voice/{forced}]`.
- Sidecar returns detected language in response; whisper.ts returns
  `WhisperResult { text, language }`.
- Whisper timeout increased to 60s for large-v3 multi-pass.

### Testing

- `src/mime-enricher.test.ts`: 7 tests covering enrichment pipeline,
  race condition (fast-settling enrichment before wait), error swallowing.
- `src/mime-handlers/voice.test.ts`: updated for multi-pass labels and
  `WhisperResult` return type.
- `src/mime-handlers/whisper.test.ts`: updated for `WhisperResult`,
  60s abort timeout.
- `specs/v2/autotesting.md`: test strategy for all subsystems.

---

## [v0.2.6] — 2026-03-04

### Testing

- `vitest` added as devDependency; `make test` and npm scripts use bare
  `vitest run` (no npx/bunx wrapper)
- `src/config.test.ts`: live-binding assertions for config overrides;
  `_resetConfig()` restores defaults from env in `afterEach`
- `container-runner.ts`: `export let _spawnProcess = spawn` seam allows
  mocking docker without a running daemon
- Fixed container-runner test mocks: missing `HOST_APP_DIR`/`WEB_HOST`
  constants; `readFileSync` mock returning `''` now returns `'{}'`
- `specs/v1/testing.md`: all testability gaps marked shipped

### Config

- 7 constants changed `const` → `let` in `config.ts`: `SLINK_ANON_RPM`,
  `SLINK_AUTH_RPM`, `WHISPER_BASE_URL`, `VOICE_TRANSCRIPTION_ENABLED`,
  `VIDEO_TRANSCRIPTION_ENABLED`, `MEDIA_ENABLED`, `MEDIA_MAX_FILE_BYTES`
- `_overrideConfig` mutates live bindings directly (was partial)
- `_resetConfig()` added to restore defaults from env; both gated behind
  `NODE_ENV=test`

---

## [v0.2.5] — 2026-03-04

### Gateway

- Fix `hostPath()` to replace `PROJECT_ROOT` instead of `APP_DIR`, fixing
  wrong host mount paths for IPC/session dirs when running inside Docker
- Fix `ipc.ts` file sending: use `HOST_GROUPS_DIR` (host path) instead of
  `GROUPS_DIR` (container-internal path), fixing ENOENT on `sendDocument`

### Skills

- Auto-migration nudge: gateway prepends annotation to agent prompt when
  group skills are behind `MIGRATION_VERSION`
- `MIGRATION_VERSION` bumped to 4

### Specs

- All `specs/v1/` marked with shipped/partial/open status
- `specs/v1/sync.md` rewritten as solved

### Cleanup

- Delete stale `template/workspace/mcporter.json` artifact
- Fix stale template path in `container/skills/howto/SKILL.md`

---

## [v0.2.4] — 2026-03-04

### CLI

- `kanipi config <instance> user list|add|rm|passwd` for local user management;
  passwords hashed with argon2; values passed via env vars to prevent shell injection

### Auth

- `POST /auth/refresh`: token rotation — issues new access + refresh token pair,
  invalidates old refresh token
- `POST /auth/refresh` JWT now carries correct user name (was using sub string)
- OAuth providers deferred to `specs/v3/auth-oauth.md`

### Specs

- `specs/v1/auth.md`: updated to reflect v1 implementation

---

## [v0.2.3] — 2026-03-04

### Gateway

- Email channel: IMAP IDLE loop with SMTP reply threading, routes to main
  group; enabled by `EMAIL_IMAP_HOST` config
- `send_file` Discord support: `sendDocument` via `AttachmentBuilder`
- `send_file` WhatsApp support: `sendDocument` via baileys document message
- `src/mime.ts`: shared `mimeFromFile()` helper using file-type (magic bytes)
- `email_threads` table in DB: `getEmailThread`, `getEmailThreadByMsgId`,
  `storeEmailThread` for SMTP reply threading
- Explicit `DATA_DIR`/`HOST_DATA_DIR`/`HOST_APP_DIR` env vars replace brittle
  `/proc/self/mountinfo` host-path detection; gateway cwd stays at `/srv/app`

### Agent skills

- Migration 004: enforce `send_file` for file delivery (CLAUDE.md rule);
  `send_file` accepts any `/workspace` path, not restricted to `media/`

---

## [v0.2.2] — 2026-03-04

### Gateway

- Outbound file sending: `send_file` MCP tool lets agents send files to users
  as document attachments (Telegram); IPC `type:'file'` handler with
  path-safety check against GROUPS_DIR
- Session error eviction: on agent error output, session ID is not persisted;
  on error status, the session pointer is removed from DB (JSONL kept on disk)
  so the next retry starts a fresh session rather than re-entering a corrupted one
- Inject `NANOCLAW_IS_MAIN` into agent `settings.json` on every spawn (was
  never set, so agents always saw it as empty)

### Agent skills

- `migrate` skill: replace `/workspace/global` dir-existence check with
  `NANOCLAW_IS_MAIN != 1` check — the dir always exists due to Dockerfile
  mkdir, making the old check unreliable for main-group detection

---

## [v0.2.1] — 2026-03-04

### Agent runner

- Progress updates: every 100 SDK messages, emits last assistant text snippet
  to the channel so users see activity on long runs
- `error_max_turns` recovery: resumes the session with `maxTurns=3` and asks
  Claude to summarise what was accomplished and what remains, then prompts the
  user to say "continue"

---

## [v0.2.0] — 2026-03-04

### Slink web channel

- Added `POST /pub/s/:token` endpoint — web channel for groups registered as `web:<name>`
- Served `sloth.js` client widget at `/pub/sloth.js`
- Verified JWT signatures (HS256) for authenticated senders
- Added anon/auth rate limiting via `SLINK_ANON_RPM` / `SLINK_AUTH_RPM` config
- Supported `media_url` attachments with MIME type guessing
- Added SSE stream at `/_sloth/stream` for agent-to-browser push
- Added `slink_token` column on `registered_groups`; added `generateSlinkToken` helper
- Fixed expired JWT treated as anon (now returns 401)
- Fixed slink deduplication and SSE error logging

### Auth layer

- Added auth DB schema: `users`, `sessions`, `oauth_accounts` tables
- Added auth query functions: `createUser`, `getUserByProvider`, `createSession`, etc.
- Added `AUTH_SECRET` config constant for JWT signing
- Added web UI auth spec at `specs/v1/auth.md`

### Whisper sidecar

- Added self-contained `kanipi-whisper` docker image, deployed via Ansible
- Added `whisperTranscribe` helper with 30s abort timeout
- Updated voice and video handlers to use shared whisper endpoint

### Mime pipeline

- Added attachment enrichment before agent dispatch
- Added handler registry: voice, video, image handlers
- Dispatched handlers in parallel with `allSettled` (partial failure safe)
- Added MIME type detection, file save, and annotation lines

### Workspace and agent identity

- Mounted `/workspace/self` read-only to expose full kanipi source to agent
- Replaced `SOUL.md` with ElizaOS-style `character.json`
- Added per-query field randomisation and global override merge in `character.json`
- Split `web/pub/` as unauthenticated boundary; `/pub/` prefix is public

### Skills and migrations

- Added `self` skill: agent introspection — layout, skills, channels, migration version
- Added `migrate` skill: main-group skill sync + migration runner across all groups
- Added migration system: `container/skills/self/migrations/` with versioned files
- Added migration 001: move `web/` root files to `web/pub/` per new layout convention
- Added YAML frontmatter to `web/SKILL.md`
- Updated `info/SKILL.md` to report migration version and warn if migrations pending

### Build

- Added `container/Makefile` for `kanipi-agent` image builds
- Added `sidecar/whisper/Makefile` for `kanipi-whisper` image builds
- Root `make image` now builds only the gateway (`kanipi`)

### Testing

- Added testability seams: `_initTestDatabase`, `setDatabase`, `_overrideConfig`
- Reached 306 tests across 22 files

---

## [v0.1.2] — 2026-03-01

### Added

- Signal-driven IPC: gateway sends SIGUSR1 after writing IPC file; agent
  wakes immediately, falls back to 500ms poll — eliminates busy-waiting

### Fixed

- Race condition in wakeup/timer assignment in agent IPC polling
- `cleanupOrphans` dual-filter restored to OR logic (AND regression in v0.1.1)
- Typing indicator now stops correctly when agent finishes responding
- Extracted `signalContainer` and `scanGroupFolders` helpers to deduplicate
  signal-sending logic

---

## [v0.1.1] — 2026-03-01

### Added

- Skills consolidated into `container/skills/`; seeded once per group on
  first container run
- Vite web server integrated into gateway startup via IPC restart
- Web app template seeded from `template/web/` on `kanipi create`
- Group management CLI (`kanipi group list|add|rm <instance>`)
- `hello` and `howto` skills bundled in agent image
- Pre-commit hooks: prettier, typecheck, hygiene (`.pre-commit-config.yaml`)
- Makefile targets: `build`, `lint`, `test`
- Discord channel via discord.js (`channels/discord.ts`)
- Env-based channel toggling: Telegram by `TELEGRAM_BOT_TOKEN`, Discord by
  `DISCORD_BOT_TOKEN`, WhatsApp by `store/auth/creds.json` presence

### Changed

- `TELEGRAM_ONLY` flag removed; channel selection is token/credential-driven
- Unified `ChannelOpts` type across all three channel modules

### Fixed

- Render markdown as HTML in Telegram; keep typing indicator alive during
  long responses
- Agent-team subcontainers cleaned up on gateway startup
- Fallback to script-relative template dir when not running inside container
- Docker-in-docker mount paths and agent container write permissions
- Bootstrap chicken-and-egg: `group add` now creates DB schema if missing
- `appDir` used for skills source path instead of `process.cwd()`

---

## [v0.1.0] — 2026-03-01

Initial kanipi release — nanoclaw fork with Telegram support and
multitenant instance model.

### Added

- Fork of nanoclaw at upstream v1.1.3
- Telegram channel (`channels/telegram.ts` via grammy)
- `kanipi` bash entrypoint: `create`, `group`, and instance-run commands
- Per-instance data layout: `/srv/data/kanipi_<name>/`
- systemd unit file templating via `kanipi create <name>`
- `container/agent-runner/` in-container Claude Code entrypoint
- Docker-in-docker host path translation (`detectHostPath()` via
  `/proc/self/mountinfo`)

### Inherited from nanoclaw v1.1.x

- Mount project root read-only (container escape prevention)
- Symlink and path-escape blocking in skills file ops
- `fetchLatestWaWebVersion` to prevent WhatsApp 405 failures
- Host timezone propagation to agent container
- `assistantName` passed to agent (was hardcoded as `'Andy'`)
- Idle preemption correctly triggered for scheduled tasks
