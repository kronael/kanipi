# Changelog

All notable changes to kanipi are documented here.

kanipi is a fork of [nanoclaw](https://github.com/nicholasgasior/nanoclaw)
(upstream at v1.1.3).

---

## [Unreleased]

### Added

- **Template overlays via `/migrate` (migration 044)**: `/migrate` step d) reads `~/.claude/skills/self/TEMPLATES` per group and applies named overlays from `/workspace/self/templates/<name>/` — SOUL.md/SYSTEM.md replace, CLAUDE.md sections merge, skills/output-styles copy with managed/disabled respect.

---

## [v1.0.6] — 2026-03-20

### Fixed

- **Reply threading**: multi-part agent responses now chain correctly — each reply threads off the previous bot message instead of all replying to the original user message. `lastSentId` was not updated after each send in the main agent callback.
- **@agent / #topic routing**: detection now checks message content directly (`/@\w/`, `/#\w/`) so symbols anywhere in the message trigger routing. Previously broken because the default route (seq 0) always resolved before the prefix routes (seq 9998/9999), so `resolved.match` was never `'@'` or `'#'`.
- **Route seq ordering**: `@` and `#` auto-routes now registered at seq -2/-1 (before default at seq 0). Migration 0016 fixes existing DBs.

---

## [v1.0.5] — 2026-03-20

### Added

- **Output styles for all channels**: `whatsapp`, `web`, `twitter`, `bluesky`, `mastodon`, `reddit`, `facebook` — each documents exactly what markdown renders vs what breaks, derived from the actual gateway conversion code.

### Fixed

- **Improved telegram/discord/email style content**: telegram now explains that `_underscores_` in identifiers are dangerous (accidentally italicized by `mdToHtml`); whatsapp style accounts for `markdownToWhatsApp()` (only bold/strikethrough converted).

---

## [v1.0.4] — 2026-03-20

### Fixed

- **Output styles not applied**: output style frontmatter names were capitalized (`Telegram`, `Discord`, `Email`) but the SDK registry lookup uses the lowercase channel name (`telegram`, etc.) — styles were loaded but never matched, so formatting instructions were never injected into the agent's context.

---

## [v1.0.3] — 2026-03-20

### Fixed

- **Task not found error**: cancelling/pausing a non-existent task now returns `"not found"` instead of `"unauthorized"`, so agents can distinguish missing tasks from permission errors.

---

## [v1.0.2] — 2026-03-20

### Added

- **Skill `/recall-messages`**: v1 searches older chat messages via `get_history` IPC using an Explore subagent.
- **Spec `get_history`**: IPC action spec for on-demand message history retrieval (`specs/1/O-get-history.md`).

### Changed

- **Skill rename**: `/recall` → `/recall-memories` (migration 043).
- **Agent self-exit**: container exits when IPC input is empty per L-chat-bound-sessions spec (previously polled forever).
- **IPC message format**: gateway now writes `{ id, text, chatJid }` to input files per spec.

### Fixed

- **Telegram reply NaN (B1)**: `reply_parameters.message_id` guarded with `!isNaN()` — omitted if replyTo is non-numeric.
- **Heartbeat typing indicator (B6)**: heartbeat (null result) now calls `startTyping()` instead of stopping the indicator and signalling idle.
- **WhatsApp route JID (B4)**: `addRoute()` normalizes `whatsapp:` JIDs to include `@s.whatsapp.net` suffix.
- **WhatsApp AwaitingInitialSync (B8)**: `shouldSyncHistoryMessage: () => false` added to `makeWASocket()` — eliminates the 20s sync wait on every connect.

---

## [v1.0.1] — 2026-03-19

### Added

- **OAuth domain/org restriction**: `GOOGLE_ALLOWED_EMAILS` (comma-separated glob patterns, e.g. `*@marinade.finance`) restricts Google OAuth. `GITHUB_ALLOWED_ORG` restricts GitHub OAuth to org members. Google Workspace `hd=` hint passed automatically when single domain detected.

### Fixed

- **Reply target**: bot always reply-quotes the triggering user message across all channels. Previously `lastSentId` was updated to the bot's own message ID after each chunk, causing multi-chunk responses to chain-reply to themselves instead of the user.
- **WhatsApp reply-quoting**: `sendMessage` now passes `contextInfo: { stanzaId }` to Baileys so WhatsApp shows the reply bubble. Previously the `replyTo` parameter was silently ignored (`_opts`).
- **Agent heartbeat**: agent-runner emits a null-result heartbeat every 30s during long queries to reset the gateway idle timeout. Prevents containers being killed mid-response on slow LLM calls.
- **Agent silent-fail**: if SDK returns no result message and no exception, user now gets a visible error and a retry prompt instead of silence.
- **WhatsApp JID routing**: route matching now works with full JIDs including `@s.whatsapp.net` domain suffix (Baileys delivers messages with full JID; bare phone numbers in routes were silently dropped).
- **Local channel FK**: `LocalChannel.sendMessage` now upserts the chat row before storing the message, satisfying the `messages → chats` FK constraint.
- **Local channel loop**: agent responses on the local channel are marked `is_bot_message: true` so they are not re-ingested by the message loop and do not re-trigger the agent.
- **Onboarding `/request` parsing**: regex now accepts `/requestname`, `/request[name]`, and `/request(name)` in addition to `/request name`.

---

## [v1.0.0] — 2026-03-19

### Added

- **Google OAuth**: `/auth/google` + `/auth/google/callback` — sign in with Google alongside GitHub, Discord, Telegram.
- **WebDAV file access**: `/dav/:group/*` proxy with Basic Auth, SHA-256 token storage, group ACL, path safety. CLI: `kanipi user webdav-token`, `kanipi user webdav-groups`. Migration 0015.
- **Dash-memory editors**: inline MEMORY.md + CLAUDE.md edit/save via HTMX in the knowledge browser.
- **Evangelist narrative editor**: inline textarea edit/save/new for `narratives/` from the evangelist dashboard.
- **Topic routing redesign**: `#topic` messages stored with `topic` attribute on message row; views display `(chat_jid, topic)` pairs as separate conversations. JID stays as the channel address.

### Changed

- **Version scheme**: all pre-v1.0.0 releases retroactively tagged as `v0.x.x`. v1.0.0 is the first production release with OAuth and multi-social support complete.

### Removed

- ~84 redundant tests trimmed (1036 → 952 tests across 62 test files).

---

## [v0.11.0] — 2026-03-18

### Added

- **Evangelist template**: community engagement agent. File-based post pipeline (`posts/drafts/approved/scheduled/posted/rejected/`). Agent browses web, drafts from narratives+ideas+facts, human approves via dashboard. Directory IS the status — no frontmatter `status:` field.
- **Evangelist dashboard** (`/dash/evangelist/`): marker-based discovery (`.evangelist` file), calendar view, tweet/post card modes, narratives tab, knowledge tab, approve/reject via file moves.
- **Narratives + ideas**: `narratives/` (story angles, voice, consulted first when drafting), `ideas/` (ephemeral operator inputs, depleted after drafting).
- **Group git repos**: every group folder auto-initialized as a git repo on creation. Parent gitignores children. `kanipi git-init`, `kanipi create --from <repo>`. Agent git-repo skill with commit discipline.
- **Dash-memory**: full read-only knowledge browser at `/dash/memory/` (MEMORY.md, CLAUDE.md, diary, episodes, users, facts, search).
- **Dash-onboarding**: pending requests and approval history at `/dash/onboarding/`.
- **Migration 039**: git-repo skill. **Migration 040**: evangelist skills.

---

## [v0.10.8] — 2026-03-18

### Added

- **Topic routing (`#topic`)**: messages prefixed with `#topic` run in a
  named session within the same group — persistent, isolated context per topic.
- **Child delegation (`@agent`)**: messages prefixed with `@childname` are
  delegated to a matching child group. Unknown child falls through to self
  (not dropped).
- **Prefix route type**: new `prefix` route type in router for `@`/`#`
  pattern matching; auto-inserted at seq 9998/9999 (user routes can override).
- **default SOUL.md**: personal soul distilled from user identity — builder,
  boring code philosophy, anti-fluff.
- **researcher template removed**: default template is the dev+research+assistant
  profile; researcher was redundant.

### Fixed

- **`@`/`#` route priority**: prefix routes inserted at seq 9998/9999 so
  user-defined routes are evaluated first and can override them.

---

## [v0.10.7] — 2026-03-18

### Added

- **Dashboard panels**: tasks, activity, groups dashboards fully implemented.
  Portal upgraded to 2-column tile grid with HTMX health dots (30s refresh).
- **Skill disable/pin in templates**: `disabled: true` in a skill's SKILL.md
  prevents `migrate` from overwriting it; `managed: local` pins a customized
  skill. Support template uses this for `web` (disabled), `hello`, `howto`.
- **templates/default/.claude tracked in git**: skills and migrations now in
  version control (previously gitignored after prototype→templates rename).
- **Support template skills**: `hello` and `howto` skills customized for
  support bots — no web/developer content, focused on user-facing help.
- **Template READMEs**: `templates/support/README.md` and
  `templates/researcher/README.md` with setup, deployment model, and skill
  behavior tables.
- **Tier 2 deployment guidance**: support template documents recommended
  `<world>/<world>/support/` tier-2 group structure.

### Fixed

- **DB functions**: added `getTaskRunLogsForTask`, `getRecentMessages`,
  `getAllOnboarding` used by new dashboards.

---

## [v0.10.6] — 2026-03-18

### Fixed

- **Onboarding message delivery**: all channels now pass messages from
  unregistered JIDs to the gateway. Previously the channel layer silently
  dropped them, so `/request` never reached the onboarding handler.
- **`/request` without name**: defaults to sender's username (stripped of
  leading `@`, lowercased) instead of requiring an explicit name.

---

## [v0.10.5] — 2026-03-18

### Added

- **Product templates**: `prototype/` renamed to `templates/default/`; new
  `templates/support/` and `templates/researcher/` product templates with
  SYSTEM.md, SOUL.md, CLAUDE.md for their respective agent roles.
- **`kanipi create --template <name>`**: create an instance from a named
  product template (`default`, `support`, `researcher`). Agent skills always
  seed from `templates/default/.claude/` regardless of template chosen.
- **Memory & Knowledge dashboard**: `/dash/memory/` shows facts, episodes,
  and MEMORY.md per group.
- **Platform permissions**: `set_grants`/`get_grants` IPC actions; removed
  `maxTier` dual enforcement from action-registry (grants.ts is the single source).
- **SSE stream auth**: `/_sloth/stream` now requires a valid session cookie
  for private groups (`!webPublic && authSecret`). `/_sloth/message` stays
  public for embedded widget use.
- **Episodic memory**: `compact-memories` skill + `episode.ts` gateway
  injection documented in CLAUDE.md and `self/SKILL.md`.
- **Voice roundtrip tests**: integration tests for processAttachments +
  voiceHandler pipeline.

### Fixed

- **`spawn_group` recursive copy**: replaced flat file loop with
  `copyDirRecursive` — prototype subdirectories (e.g. `.claude/`) now copied.

---

## [v0.10.4] — 2026-03-18

### Changed

- **Agent content moved to `prototype/.claude/`**: skills, CLAUDE.md, and
  output-styles are now seeded from `prototype/.claude/` instead of `container/`.
  Prototype is the single source of truth for what new agent containers receive.
  `container/` now contains only build artifacts (Dockerfile, agent-runner).

- **Agent image build context**: Makefile now builds agent image from repo root
  (`-f container/Dockerfile .`) so `prototype/.claude/output-styles/` is
  accessible during the Docker build.

- **`CONTAINER_IMAGE` default**: changed from `nanoclaw-agent:latest` to
  `kanipi-agent:latest` in config.ts.

---

## [v0.10.3] — 2026-03-18

### Fixed

- **`outputStyle` not injected**: `settings.json` is the correct place for
  `outputStyle`; passing it in SDK query options breaks the async iterator
  for new sessions. agent-runner now writes `channelName` to `settings.json`
  only and omits it from query options, so channel-specific formatting rules
  (telegram.md etc.) are applied correctly.

- **New groups produce zero messages**: agent-runner now seeds `.claude.json`
  (with `{}`contents) before spawning the SDK for new groups. Without it the
  Claude Code SDK silently returns 0 messages on the first run, leaving new
  groups permanently broken.

- **Onboarding never triggered**: `getNewMessages` was called with only
  `getRoutedJids()`, so new users with no routes never had their messages
  fetched and `handleOnboarding` was never reached. Fixed by appending
  `getUnroutedChatJids(since)` to the JID list when `ONBOARDING_ENABLED`.

### Changed

- **Status message prompt**: `container/CLAUDE.md` clarified — emit
  `<status>` for long/complex tasks to acknowledge work and set time
  expectations; not for simple one-step replies.

---

## [v0.10.2] — 2026-03-18

### Fixed

- **`@root /cmd` routing**: strip `@word` prefix before gateway command detection
  so commands like `@root /approve` are dispatched correctly instead of being
  forwarded to the agent as plain text.

### Changed

- **`/approve` / `/reject`**: no JID required — defaults to oldest pending when
  only one exists; shows numbered list when multiple pending; accepts number
  (`/approve 1`) or explicit JID.

---

## [v0.10.1] — 2026-03-18

### Changed

- **Approve override**: `/approve` now allows re-approval of already-approved
  entries (override). World folder already existing on filesystem is no longer
  an error — routes to the existing folder instead of failing.

---

## [v0.10.0] — 2026-03-18

### Added

- **Onboarding state machine**: gateway-level self-service onboarding, no LLM
  required. New users send `/request <name>` → pending approval → root admin
  runs `/approve <jid>` or `/reject <jid>`. On approval: copies
  `groups/root/prototype/` to new world folder, registers group and route,
  enqueues welcome system message. Enable via `ONBOARDING_ENABLED=1`.

### Fixed

- **WhatsApp crash loop**: replaced `process.exit()` on reconnect failure
  with exponential backoff `scheduleReconnect()`. LoggedOut case also
  schedules a slow reconnect rather than exiting (systemd restart loop fixed).
- **Command double-processing race**: `processGroupMessages` (queue path)
  now skips gateway commands, preventing a race where the message loop and
  queue both process the same `/approve`-style command.
- **Onboarding duplicate routes**: removed redundant `addRoute`/`setGroupConfig`
  calls in approve.ts — `registerGroup` handles both (plus the `local:` route).
- **Onboarding world_name collision**: checks `getGroupByFolder` before
  filesystem check; rejected users now receive a message instead of silence.

### Changed

- **Impulse gate: social platforms only** — messaging platforms (Telegram,
  WhatsApp, Discord, Email, Web) always pass through immediately. Impulse
  accumulation retained only for social platforms (Twitter, Mastodon, Bluesky,
  Reddit, Facebook, Instagram, Threads, LinkedIn, Twitch, YouTube).

---

## [v0.9.0] — 2026-03-17

### Added

- **Action grants**: tier-based permission system for agent actions. Glob
  syntax rules with param matching, DB-backed overrides, delegation scoping.
  Replaces `assertAuthorized`/`maxTier` with single grants enforcement point.
- **SYSTEM.md support**: per-group custom system prompt replaces the default
  Claude Code system prompt. ElizaOS-inspired should-respond rules, knowledge
  pipeline, and focused tool guidance for user-facing bots.
- **Dashboard portal**: HTMX-based `/dash/` with status dashboard, fragment
  endpoints at `/x/`, live gateway state.
- **`/recall` skill**: searches facts/, diary/, users/, episodes/ for
  relevant knowledge via summary: frontmatter grep. Replaces manual
  summary scanning in CLAUDE.md Knowledge section.
- **Recall v2 CLI**: `recall` CLI tool with FTS5 + sqlite-vec hybrid search.
  Per-store SQLite DBs, lazy mtime-based indexing, Ollama embeddings,
  RRF fusion (0.7 vector, 0.3 BM25). Config via `.recallrc` (TOML).
- **Episode injection**: gateway injects most recent day/week/month episode
  summaries into agent prompt on session start (`<episodes>` XML block).
- **`/compact-memories` skill**: progressive compression of session transcripts
  into daily/weekly/monthly episodes, plus diary week/month summaries.
- **Facts verifier audit trail**: verifier writes pass/fail YAML records to
  `verifier/` directory, preserving rejected fact history.
- **Subsystem resilience**: crash on fatal channel errors, fix IPC poll loop.
- **Playwright e2e tests**: 22 tests for dashboards with isolated gateway.

### Fixed

- **Bot-mention override**: `mentions_me="true"` always triggers visible
  response, overrides all silence rules in container CLAUDE.md.
- **WhatsApp reconnect hang**: `connect()` promise no longer hangs when
  first attempt errors and triggers reconnect.
- **Grammy deaf gateway**: exit on silent polling stop to prevent deaf state.
- **Orphan cleanup scoping**: scoped to own container image, prevents
  cross-instance kills in multi-instance deployments.
- **Message tracing**: consistent group names, timing in queue, delegation
  logs, removed redundancy.
- **Recall fixes**: require Ollama for search (no silent FTS fallback),
  skip files cleanly on embed fail, compact-memories on-demand cron.
- **SDK update**: claude-agent-sdk 0.2.34 → 0.2.76 (OAuth token flow fix).

### Changed

- **Test suite**: 792 → 926 tests across 53 files. Added grants unit/
  integration/e2e tests, Playwright dashboard tests.
- **Strict knowledge relevance**: facts must answer 100% correctly or
  agent researches. Mandatory `<think>` deliberation before answering.

### Docs

- **Action grants spec**: tier-based social defaults, glob matching, param
  exclusion, manifest constraints, delegation scoping.
- **Dashboard specs**: portal, status, activity, groups, memory, tasks —
  6 specs with HTMX stories and fragment endpoints.
- **Control chat + onboarding spec**: gateway command channel, unrouted
  JID approval flow.
- **Code research agent spec**: merged `4/H-researcher` and `4/3-support`
  into `3/3-code-research.md` — ElizaOS patterns, SYSTEM.md reference.
- **Memory specs**: fixed stale refs across D-knowledge-system,
  M-memory-managed. Added Worlds concept to `4/K-versioning-personas.md`.

---

## [v0.8.0] — 2026-03-14

### Added

- **Auth overhaul**: removed Basic auth (`SLOTH_USERS`), session-based auth
  via `AUTH_SECRET` + JWT. OAuth login for GitHub, Discord, Telegram.
  User management CLI: `kanipi user add/remove/list/passwd`.
- **Vhost redirects**: `web-proxy.ts` reads `vhosts.json`, redirects by
  `Host` header with path traversal protection.
- **Tier 1 web mount isolation**: tier 1 containers mount only their
  world's web subdirectory, not the full web dir.
- **Infra skill**: root agent skill for hostname assignment, DNS
  verification, and web directory setup.
- **Gateway-level impulse filter**: replaced 5 per-channel filters with
  one `Map<string, ImpulseState>` in the message loop.

### Changed

- **Test suite**: pruned ~100 redundant tests (891→792), coverage audit
  added 219 tests across all subsystems.
- **Specs audit**: fixed 12 inaccuracies across phase 3 specs.
- **Code refinement**: -148 lines from auth, config, web-proxy,
  container-runner, db.

---

## [v0.7.0] — 2026-03-14

### Added

- **Reply routing**: `Channel.sendMessage` returns sent message ID
  (`string|undefined`). All channels (telegram, whatsapp, discord, email)
  return the platform message ID.
- **Chunk chaining**: consecutive message chunks track `lastSentId` for
  reply-threading on platforms that support it.
- **Per-sender batching**: `delegatePerSender` helper batches messages by
  sender before delegating to child groups.
- **Escalation origin annotation**: `local:` responses wrapped with
  `<escalation_origin jid="..." messageId="...">` XML for round-trip
  context.
- **`send_reply` auto-injects `replyTo`**: reply context from
  `ActionContext` is automatically applied; `send_message` and `send_reply`
  return the sent `messageId`.
- **`delegate_group` / `escalate_group`**: now pass `messageId` and
  `escalationOrigin` through IPC.
- **SYSTEM.md override**: agent-runner uses `SYSTEM.md` in group home to
  replace the default Claude Code system prompt entirely.
- **`<internal>` tag stripping**: moved from gateway (`router.ts`) to
  agent-runner for cleaner separation.
- **Escalation protocol**: `escalate_group` wraps prompt in `<escalation>`
  XML, round-trips via `local:` JIDs with `LocalChannel`.
- **Permission tiers**: tier 2 `send_message` restricted to own JID,
  tier 1 can manage any task (cancel/pause/resume).
- **Local JID convention**: `local:{folder}` auto-routed to group folder,
  `messageId` wired through `start.json` and `ActionContext`.

### Changed

- **ActionContext**: `messageId` added on delegation methods; dead `command`
  field removed.
- **IpcDeps**: delegation signatures updated with `messageId` and
  `escalationOrigin` parameters.
- **Route authorization**: messaging authorized by all route targets, not
  just hub group.

---

## [v0.6.0] — 2026-03-13

### Added

- **Auto-threading**: route targets support RFC 6570 `{sender}` templates
  (e.g. `atlas/{sender}`). Gateway expands at routing time, auto-creates
  child group folders per sender via `spawnGroupFromPrototype`.

### Fixed

- **Agent-runner stream stall**: close SDK query after result delivery
  instead of waiting for 60s watchdog timeout. Fixes session timeouts.
- **Agent-runner max-turns**: add try-catch and break to prevent hang on
  summary query failure.
- **Session eviction**: don't evict session when output was already sent
  to user (prevents losing working sessions on transient errors).
- **Delegate typing**: wrap `delegateToGroup` callback in try-finally so
  typing indicator always stops, even on error.
- **Dockerfile**: `--break-system-packages` for uv pip install.

### Changed

- **Group folder validation**: dropped `SEGMENT_PATTERN` charset
  restriction. Validates traversal safety only (no `..`, no `\`, no
  absolute paths, non-empty segments ≤128 chars).

---

## [v0.5.0] — 2026-03-13

### Added

- **Rich container tooling**: Dockerfile now includes go, rust, uv, ffmpeg,
  yt-dlp, python3, pandas, matplotlib, plotly, scipy, numpy, python-pptx,
  openpyxl, weasyprint, marp-cli, biome, ruff, pyright, shellcheck,
  prettier, htmlhint, svgo, ripgrep, fd-find, fzf, tree, bat, imagemagick,
  optipng, jpegoptim, pandoc, poppler-utils, tesseract-ocr, httrack, whois,
  traceroute, dnsutils, jq
- **Generic channel auth CLI**: `kanipi config <instance> channel auth <name>`
  for channel-agnostic authentication flows
- **Acquire skill**: multimedia data acquisition patterns (yt-dlp, whisper,
  web scraping)
- **Specs skill**: how to write/manage specs with YAML frontmatter
- **WHISPER_BASE_URL**: passed to container env so agents can transcribe
  audio directly via the whisper HTTP API
- **Tools list in container CLAUDE.md**: agents always see their available
  tools (runtimes, linters, media, research, data, office, network, search)
- **User context**: gateway injects `<user id="..." name="..." memory="..." />`
  tag with sender identity. Agent reads `~/users/<id>.md` for per-user memory.
  New `/users` skill for managing user context files.
- **Status messages**: agent emits `<status>text</status>` blocks, agent-runner
  strips them and sends as interim updates to users.
- **Think blocks**: `<think>...</think>` blocks stripped by agent-runner,
  enabling silent deliberation in group chats.
- Migration 027: user context docs and skill.
- Migration 031: rich container tooling and whisper transcription.

### Changed

- **Spec cleanup**: YAML frontmatter on all 93 specs, trimmed ~1500 lines
  of shipped implementation details
- **Autotesting spec**: rewritten to strategy-only (no coverage inventory)

### Tests

- 36 new tests: tasks, file commands, stop command

### Fixed

- **Web channel sender prefix**: web channel now uses `web:anonymous` sender
  format instead of bare `web`, matching the `scheme:id` convention.
- **JID migration coverage**: migration 0007 now covers all platforms
  (web, reddit, twitter, mastodon, bluesky, facebook) in addition to
  the original four (telegram, whatsapp, discord, email).
- **Agent entrypoint**: `buildContainerArgs` now defaults to `/app/entrypoint.sh`
  command, fixing code 127 on agent images with `/bin/bash` entrypoint.
- **Test assertions**: updated `sendMessage` test expectations to match 3-arg
  signature after `replyTo` addition.

---

## [v0.3.5] — 2026-03-12

### Fixed

- **Stream-stall watchdog**: reduced timeout from 5min to 1min, checks every
  10s. On stall, sends user-visible `⚠️ Connection stalled — say "continue"
to retry.` before aborting. Agent errors also now surface to the user.
- **Telegram reply threading**: bot replies now use `reply_to_message_id` to
  thread responses to the triggering message.
- **Orphan cleanup on startup**: `cleanupOrphans` now called at gateway start,
  killing any leftover `nanoclaw-*` containers from previous runs.

### Docs / Specs

- `3/L` — Chat-bound sessions, `send_reply` action, `IDLE_TIMEOUT=0`
- `3/M` — `<think>` blocks for silent group-chat decisions
- `3/N` — Agent-initiated `<status>` updates
- Skills: escalation, delegation, `send_reply` documented in self skill

---

## [v0.3.4] — 2026-03-12

### Fixed

- **SOUL.md persona nudge**: system prompt now tells agent to respond in its
  `~/SOUL.md` persona and re-read the file if not already in context. Previously
  the hint did not reference the path, so after auto-compact the persona was lost.

### Refactored

- **`'main'` folder name wiped**: all source and test files now use `'root'` as
  the root group folder name, consistent with `isRoot()`. No migration needed —
  new instances have always defaulted to `root`; the `'main'` string no longer
  appears anywhere as a folder identifier.

### Docs

- **5-permissions spec**: documented `local:` JID namespace for escalation return
  path, delegation XML prompt format, enforcement at action handler layer, and
  `send_message` prohibition on `local:` targets.
- **Roadmap**: phase 3 is kanipi v1.x (not instance-specific); phase 4 renamed
  arizuko (deferred); `4/1-agent-routing` dropped (superseded by nested groups).
- **4/W spec**: file-based container IPC for gateway reclaim on restart.

---

## [v0.3.3] — 2026-03-12

### Tests

- Regression test for nested IPC group discovery (parent + child both having
  `requests/` — the old `else` branch would have skipped the child).
- Regression test for tier 2 messaging auth: `atlas/support` can send to a JID
  routed to `atlas` (same world, not same folder).

---

## [v0.3.2] — 2026-03-12

### Fixed

- **send_message / send_file auth for nested agents**: tier 1-2 agents can now
  send to any JID in their world. Previously tier 2 required the JID's default
  route to point directly to the agent — but delegation means the route points
  to the parent (e.g. `atlas`), so `atlas/support` was always blocked.

---

## [v0.3.1] — 2026-03-12

### Fixed

- **IPC watcher nested groups**: `scanGroupFolders` now recurses into
  subdirectories even when the parent has a `requests/` dir. Previously
  `atlas` being found caused `atlas/support` to be skipped — nested groups
  never got their IPC watched, `list_actions` timed out, MCP tools (including
  `send_file`) were never registered.

---

## [v0.3.0] — 2026-03-12

### Removed

- **Legacy IPC**: removed `drainLegacyMessages` and `drainLegacyTasks` — the
  `messages/` and `tasks/` IPC directories are no longer watched or drained.
  All agent→gateway IPC goes through `requests/` (request-response). No agent
  has written to the legacy dirs since v0.5.0. Tests updated.

### Fixed

- **Tier denial checks**: `ctx.tier === 3` → `ctx.tier >= 3` across all action
  handlers (delegate_group, send_file, schedule_task, pause/resume/cancel_task).
- **Silent group chat**: agents no longer output "I'm not being addressed..."
  when staying silent. CLAUDE.md requires zero output when silent.
- **Group chat participation**: relaxed silence rule — respond freely, only
  stay silent when it's clearly a side conversation between other users.
- **Group chat addressing**: agents now `@mention` the user they're replying
  to in group chats instead of broadcasting plain messages.

### Docs

- Skills trimmed: diary, hello, howto, migrate, research, web — removed fluff,
  kept essential commands and useful examples.

### Agent

- Migration 026: group chat silence and participation rules.
- Self skill migration version: 25 → 26.

---

## [v0.2.2] — 2026-03-12

### Removed

- **Trigger pattern system**: `TRIGGER_PATTERN`, `requires_trigger`, per-JID
  trigger prefixing fully removed. Routing handles everything — triggers were
  redundant and caused message content mutation (auto-prefixing `@name`).
  `getJidsThatNeedTrigger()` removed from db.ts; trigger blocks removed from
  message loop. Agent-side trigger mentions removed from container CLAUDE.md.

### Fixed

- **send_file path**: `send_file` now expands `~/` before path translation so
  agents can use `~/...` paths (previously only absolute paths worked).
- **send_file error**: improved error message — tells agent to save under `~/`
  or use `~/tmp/` for temp files that need to be sent.
- **IDLE_TIMEOUT**: reduced from 5.5 min to 1 min — active agents reset the
  timer on every output chunk anyway, so the hard timeout only matters for
  truly hung containers.

### Added

- **`containers wipe` CLI**: `kanipi config <instance> containers wipe` force-
  stops all running nanoclaw containers. Containers self-destruct on exit
  (`--rm`) so this is only needed after abnormal gateway stops.
- **Errored chat skip**: chats flagged as errored are skipped in the message
  loop until the user sends a new message, preventing retry churn on broken
  sessions.
- **~/tmp guidance**: documented `~/tmp/` as standard location for temporary
  files. Added to `container/CLAUDE.md`, self skill, migration 025.
- **Migration 024**: agents use `~` not `/home/node/` in all paths and outputs.
- **Migration 025**: `~/tmp/` for temp files; `send_file` requires `~/` paths.

### Changed

- **Container persistence**: containers no longer wiped on gateway restart —
  they self-destruct via `--rm`. Use `containers wipe` for manual cleanup.
- **Tier naming**: `minTier` → `maxTier` on actions (tier 0 is most privileged;
  field was semantically inverted).
- **Group depth**: `register_group` rejects folders deeper than 3 levels.
- **Permissions spec**: fully rewritten — tier model, mount table, gap audit,
  delegate/escalate rules, no-parent escalation error documented.
- Self skill migration version: 23 → 25

---

## [v0.2.1] — 2026-03-11

### Fixed

- **ENTRYPOINT**: Changed from `ENTRYPOINT []` to `ENTRYPOINT ["/bin/bash"]` to fix agent container crashes. Empty ENTRYPOINT caused docker to fall back to base image CMD (node), resulting in `node /app/entrypoint.sh` instead of `bash /app/entrypoint.sh` and MODULE_NOT_FOUND errors.
- **Media routing**: Fixed media being saved to wrong folder during message routing. Routing resolution now happens in `onMessage` before `enqueueEnrichment` to ensure media saves to final routed target folder (e.g., `atlas/support/media/` instead of `atlas/media/`).

### Added

- **Schedule task schema**: Added comprehensive `.describe()` field documentation to `schedule_task` action Zod schema. Agents now understand when to use `prompt` (agent mode) vs `command` (raw bash mode).
- **Session transcript reading**: Strengthened all session continuity nudges from passive "if needed" to active "MUST read BEFORE responding". Updated CLAUDE.md files in root, container, agent-runner, and self skill. Added migration 023.
- **Agent context awareness**: Added "Where am I?" section to self skill explaining that `/home/node/` is both cwd and home directory, how to find child groups, and standard directory patterns.

### Changed

- Self skill migration version: 22 → 23

---

## [v0.2.0] — 2026-03-11

### Refactor

- **Generic container commands**: renamed `runContainerAgent` → `runContainerCommand` with dual execution modes (agent ceremony vs raw bash). Removed `ENTRYPOINT` from Dockerfile; command is now supplied via docker args. Agent mode (default) includes full skill seeding, settings injection, session tracking. Raw mode skips ceremony, captures stdout as result.
- **Media paths**: `mediaLine()` now embeds container-relative paths (`~/media/...`) instead of gateway-local absolute paths for better portability
- **Config cleanup**: removed `HOST_PROJECT_ROOT_PATH` export (redundant alias; use `HOST_GROUPS_DIR`, `HOST_DATA_DIR`, `HOST_APP_DIR` directly)
- **Code quality**: extracted `appendWithLimit()`, `updateSettings()`, `formatMount()` helpers in container-runner for cleaner code organization

### Specs

- `specs/3/J-container-commands.md`: shipped — generic container execution
- `specs/3/4-paths.md`: shipped — explicit host path exports for DinD
- 7 spec files updated to use `runContainerCommand` naming

---

## [v0.1.1] — 2026-03-11

### Removed

- **Sidecar system**: removed MCP sidecar lifecycle management, types,
  specs, and `sidecar/` directory (~850 lines). Whisper runs as a
  standalone HTTP service, not a per-group sidecar. Isolated MCP
  containers deferred to phase 3.

### Specs

- `specs/3/J-container-commands.md`: generic container command execution
- `specs/4/G-instance-repos.md`: trimmed (refs section removed)

---

## [v0.1.0] — 2026-03-11

### Breaking

- **Unified home directory**: group folder mounted as `/home/node` (was
  `/workspace/group`). Agent cwd is now `/home/node`. `.claude/` state
  lives inside group folder — no separate `data/sessions/` mount.
  SOUL.md at group root (no copy to `~/.claude/`). Existing deployments
  need manual migration (move `data/sessions/*/.claude` into `groups/*/`).

### Features

- **Tiered mount security**: tier 2/3 agents get read-only overlays on
  setup files (CLAUDE.md, SOUL.md, .claude/skills, settings.json,
  output-styles). Tier 3 home is fully RO with RW overlays for
  `.claude/projects`, `media`, and `tmp` only.
- Root (tier 0) gets `GROUPS_DIR` mounted at `~/groups` for cross-group
  skill sync via `/migrate`.

### Fixes

- **Facebook**: `unban` uses query params instead of DELETE body
- **Reddit**: rate limit retry capped at 3 attempts
- **Twitter**: snowflake ID comparison uses BigInt (was string compare)
- **Social actions**: aligned platform lists — Facebook ban/unban/block,
  Reddit repost, removed Twitter unfollow

### Tests

- Container-runner: new unified home mount tests, `closeAndAwait`
  helper, hoisted setup for cleaner test structure

### Docs

- Specs updated: stale `/workspace/group` paths replaced with
  `/home/node` across `specs/1/`, `specs/2/j-social-actions.md`,
  `specs/3/5-permissions.md`
- Agent self skill: updated workspace layout and tier tables
- Migrations 015, 022: updated for new mount behavior

---

## [v0.0.24] — 2026-03-11

### Features

- Agent identity: `NANOCLAW_GROUP_NAME`, `NANOCLAW_GROUP_FOLDER`,
  `NANOCLAW_IS_WORLD_ADMIN` env vars injected into agent settings.json
- `NANOCLAW_CHAT_JID` documented in self skill — agents know their chat JID
- `get_routes` action: `jid` now optional — omit to list all routes
- IPC watcher discovers nested group folders recursively (fixes IPC drain
  for groups like `atlas/support`)

### Fixes

- Stale `set_routes` entry removed from self skill MCP tools table
  (action never existed)
- Mount table in router spec updated to show per-tier permissions

### Docs

- Permissions spec: removed stale `main` alias from pseudocode, added
  agent env vars section
- Self skill: group identity, worlds, tiers documented
- Router spec: volume mount table shows tier 0-3 permissions

### Agent

- Migration 020: group identity env vars, routing action changes
- `MIGRATION_VERSION` bumped to 020

---

## [v0.0.23] — 2026-03-10

### Features

- Default group CLAUDE.md seed: agents stay silent unless directly addressed;
  `kanipi create` writes `prototype/.claude/CLAUDE.md` into root group folder

### Refactor

- Trigger gating moved from group config into routes table — `requires_trigger`
  and `trigger_pattern` fields removed; trigger behavior is now a `trigger`
  route type per JID
- Group add/rm decoupled from JID — groups are folder configs only; routes
  managed separately via `add_route`/`delete_route` IPC actions
- `spawnGroupFromPrototype` copies from `group/prototype/` dir instead of
  parent-level files — prototype content is now self-contained per group
- Web app template moved into `container/skills/web/` (was in `prototype/`);
  `kanipi create` seeds from the skill directory
- Group-chat instructions moved from `prototype/.claude/CLAUDE.md` into
  `container/CLAUDE.md` (the agent image seed)

### Agent

- Migration 018: web scaffold now lives in web skill
- `MIGRATION_VERSION` bumped to 018

---

## [v0.0.22] — 2026-03-10

### Refactor

- Flat routing complete — `RegisteredGroup` interface removed; `ChannelOpts`
  now uses `isRoutedJid(jid)` and `hasAlwaysOnGroup()` replacing
  `registeredGroups()`
- `db.ts`: removed `getJidToGroupMap()` (wrong concept); added
  `getDefaultTarget(jid)`, `getRoutedJids()`, `getDirectChildGroupCount(parentFolder)`
  as the canonical routing query interface
- `ActionContext`, `IpcDeps`, `SchedulerDependencies`: use
  `getDefaultTarget`/`getGroupConfig`/`getDirectChildGroupCount` instead of
  `registeredGroups()`
- `container-runner.ts`: removed dead `writeActionManifest` /
  `action_manifest.json` write — the MCP server fetches `list_actions` IPC
  directly at agent startup

### Breaking

- `registered_groups.json` auto-migration removed. Operators on very old
  instances must migrate manually: run `kanipi config <instance> group add`
  for each group to re-register it in the DB.

---

## [v0.0.21] — 2026-03-10

### Features

- Social channels — mastodon, bluesky, reddit, twitter, facebook with verb/platform/thread/target/mentions_me on inbound events
- Prototype spawning — clone-on-missing with max_children enforcement, template→prototype rename
- Generic action manifest proxy — agent-runner fetches list_actions on startup, registers MCP tools dynamically
- Filtered action manifest — agents only see actions available to their tier and platform
- Two-level routing chain — gateway resolves routing rules two hops deep, spawns final target directly
- Root world privilege — root and root/\* groups can delegate to any folder in any world
- Self-targeting routing rules — enables dual-role setups (e.g. @root → root, default → atlas)
- Routing rules modifiable at runtime via set_routing_rules IPC action

### Fixes

- Skip routing delegation when target is self (no spurious auth warnings)
- Derive platforms from registered JIDs in list_actions manifest filter

### Docs

- Social events spec, social actions spec, prototypes spec rewrite
- Routing spec updated for two-level chain, root world privilege, agent-overridable rules
- Worlds spec and permissions spec aligned with root world delegation
- Router flow spec updated with routing rules step

---

## [v0.0.20] — 2026-03-09

### Features

- Session recovery — gateway writes diary entry on error/crash for next session continuity
- 5 missing MCP tools exposed to agents: delegate_group, escalate_group, set_routing_rules, refresh_groups, inject_message
- Routing auth fix: delegation now allows any descendant, not just direct children

### Docs

- Status headers added to all 18 phase 1 specs
- 5 specs aligned with shipped code (cli, actions, channels, db-bootstrap, mime)
- Session-recovery spec closed (covered by diary)

---

## [v0.0.19] — 2026-03-08

### Features

- Persona nudge appended to system prompt via SDK preset (SOUL.md)
- CLAUDE.md soul section reduced to one-liner
- Dockerfile fix: create dist/migrations dir after tsc

---

## [v0.0.17] — 2026-03-08

### Features

- Diary stop hook: nudge agent every 100 turns to write diary + prune MEMORY.md
- PreCompact hook: cleaned up, transcript archiving removed, diary nudge only
- Diary injection increased from 2 to 14 entries (two weeks)

### Changes

- Agent CLAUDE.md: diary/memory sections, session continuity, MEMORY.md verbatim reporting
- Diary skill compacted with MEMORY.md pruning nudge
- SSE spec reframed: groups as boundary, not per-sender filtering
- Diary spec finalized (all items shipped)
- Total: 549 tests across 40 files, 10,788 source LOC

---

## [v0.0.16] — 2026-03-08

### Changes

- Specs reorganized: phase/base58 naming (1/, 2/, 3/ ... 6/)
- Diary module test coverage (9 tests)
- Release skill created (/release)
- Total: 485 tests across 35 files

---

## [v0.0.15] — 2026-03-08

### Changes

- CLAUDE.md: add `group-folder.ts` to key modules list
- CHANGELOG stats alignment across v1.0.10-v1.0.14

---

## [v0.0.14] — 2026-03-08

### Tests

- Task scheduler coverage: 8 tests (invalid folder pauses task, group not found, container errors, context_mode session routing, streamed output, duplicate start prevention)
- Total: 476 unit tests across 34 files, 10,788 source LOC, 11,680 test LOC (1.08:1)

---

## [v0.0.13] — 2026-03-08

### Changes

- Container-runner: extract `initSettings()` helper, simplify IPC dir creation to loop
- Action handler test coverage: inject, session, messaging actions (13 tests)

---

## [v0.0.12] — 2026-03-08

### Changes

- Structured logging context on warnings/errors (raw output, IPC file context)

---

## [v0.0.11] — 2026-03-08

### Changes

- Group queue timing: `dur` field on task completion logs

---

## [v0.0.10] — 2026-03-08

### Features

- Production JSON logging: pino outputs JSON when `NODE_ENV=production`, pino-pretty for dev
- Trace IDs: `traceId` and `dur` (ms) in message processing for end-to-end traceability
- IPC request timing at debug level
- Task execution timing in group queue
- PREFIX semantic: all paths derive from `PREFIX` env var (default `/srv`)
- Rich `.env.example` documenting all config flags
- Agent media awareness: CLAUDE.md teaches agents to Read PDFs/images, use voice transcription text
- IPC and action-registry test coverage: 16 new tests
- Total: 521 tests across 39 files, 10,788 source LOC, 11,196 test LOC (1.04:1)

### Changes

- Deduplicate delegation: delegateToChild/delegateToParent merged into shared delegateToGroup (-40 lines)
- `inject_message` action: insert messages into DB without channel delivery
- README: prerequisites, both deployment paths, troubleshooting, WhatsApp setup, architecture
- Dev script changed from bun to tsx for consistency

---

## [v0.0.6] — 2026-03-07

### Features

- TypeScript CLI rewrite: `src/cli.ts` replaces bash `kanipi` entrypoint for group/user/mount commands
- Versioned SQL migrations: `src/migrations.ts` + `src/migrations/*.sql` files, tracked in DB `migrations` table
- Integration tests with testcontainers: `tests/integration/` runs real agent containers with scenario mode

### Changes

- Agent-runner scenario mode: `NANOCLAW_SCENARIO` env var returns canned responses for deterministic tests
- `ensureDatabase()` replaces `initDatabase()` — shared by gateway and CLI, no more inline DDL in bash

---

## [v0.0.5] — 2026-03-07

### Changes

- Cross-channel routing fix: idle containers preempted when a different channel needs the same folder
- WhatsApp markdown conversion: `**bold**` to `*bold*`, `~~strike~~` to `~strike~`
- WhatsApp read receipts: messages marked as read (blue ticks)
- Orphaned container cleanup: containers closed when group is unregistered via CLI
- Extracted `releaseGroup()` helper in group-queue for cleaner state cleanup

---

## [v0.0.4] — 2026-03-07

### Changes

- WhatsApp /chatid: respond from unregistered chats (like Telegram)
- Multi-JID groups: multiple channel JIDs can share one folder
- Permission tiers: tier-based authorization for IPC actions and mounts
- Howto skill: WhatsApp setup instructions, 3-level guide structure

---

## [v0.0.3] — 2026-03-07

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

## [v0.0.2] — 2026-03-07

### Changes

- Don't auto-retry errored messages on startup (errored flag in chats table)
- Startup protocol in CLAUDE.md (get context before acting)
- Core design facts documented (Claude Code runtime, memory is Claude-centric)
- README.md: principles manifesto (fast ecosystem, modularity as survival)
- ROADMAP.md: v1/v2/v3 progression
- Products defined: Atlas (support), Yonder (research), Evangelist, Cheerleader
- Atlas v2 spec: sandboxed support agent (frontend/backend split)
- Specs reorganized: 2/3/v2m1/v2m2 versioned milestones
- Global specs skill for spec-driven development workflow

---

## [v0.0.1] — 2026-03-06

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

## [v0.0.0] — 2026-03-06

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
- `specs/1/b-testing.md`: all testability gaps marked shipped

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

- All `specs/1/` marked with shipped/partial/open status
- `specs/1/X-sync.md` rewritten as solved

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

- `specs/1/3-auth.md`: updated to reflect v1 implementation

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
- Added web UI auth spec at `specs/1/3-auth.md`

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
