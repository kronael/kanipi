# Architecture

## Overview

Kanipi is a multitenant Claude agent gateway. It polls messaging
channels for new messages, routes them to containerized Claude
agents via docker, and streams responses back to users.

TypeScript (ESM, NodeNext), SQLite (better-sqlite3), Docker.

## Message Flow

```
Channel (telegram/whatsapp/discord/email/web)
  -> [Impulse Gate] (social channels only; chat channels bypass)
  -> DB (store message + chat metadata)
  -> message loop (poll getNewMessages)
  -> routing rules (resolveRoute: delegate to child group if matched)
  -> GroupQueue (per-group serialization)
  -> runContainerAgent (docker run)
  -> stream output back to channel
```

Vite dev server runs alongside the gateway for web apps built
by agents. Managed by the bash entrypoint (`kanipi`), not Node.

## Components

### index.ts

Main loop. Initializes channels, starts IPC watcher, scheduler,
and message poll loop. Routes incoming messages to GroupQueue.
Handles group registration and discovery across channels.

### config.ts

All config from `.env` + env vars. Exports typed constants.
Channels enabled by token presence (telegram/discord),
auth dir (whatsapp), or `EMAIL_IMAP_HOST` (email).

### db.ts

SQLite database. Stores messages, groups, routing table, chat
metadata, sessions, and scheduled tasks. All access is
synchronous (better-sqlite3). Key functions: `storeMessage`,
`getNewMessages`, `getGroupByFolder`, `setSession`.

Tables: `messages`, `groups`, `routes`, `chats`, `session_history`,
`system_messages`, `scheduled_tasks`, `task_run_logs`,
`email_threads`, `auth_users`, `auth_sessions`.

`routes` is a flat JID→target routing table. Targets may contain
`{sender}` templates (expanded at routing time). `system_messages`
stores pending events per group; flushed as XML before agent stdin.

### slink.ts

Web channel for `POST /pub/s/:token`. Rate limiting (anon/auth),
JWT verification (HMAC-SHA256), `media_url` attachments. Returns
`SlinkResponse` — HTTP wiring in `web-proxy.ts`.

### commands/

Pluggable command registry. Commands intercepted before agent queue.
Built-in: `/new` (clear session), `/ping`, `/chatid`.

### onboarding.ts

Gateway-level onboarding state machine (no LLM). Enabled via
`ONBOARDING_ENABLED=1`. States: new → pending → approved → rejected.
User command: `/request <name>`. Root commands: `/approve <jid>`,
`/reject <jid>`. On approve, copies root group's `prototype/` to a
new world folder and registers the group. Rejected users receive a
notification message. State stored in DB.

### channels/

One file per channel. Each implements `Channel` interface:

- `telegram.ts` — grammy bot, polls via webhook or long-poll
- `whatsapp.ts` — baileys client, event-driven
- `discord.ts` — discord.js client, event-driven
- `email.ts` — IMAP IDLE + SMTP reply threading

Social channels (Twitter, Mastodon, Bluesky, Reddit, Facebook) pass
through an impulse gate (`impulse.ts`) before storage: per-JID event
weights accumulate until a threshold (default 100) or hold timer
(default 5 min) triggers a flush. Chat channels (Telegram, WhatsApp,
Discord, Email, Web) bypass the gate and pass through immediately.

Each channel stores incoming messages via `storeMessage` and
provides `sendMessage(jid, text)` for outbound delivery.
`sendMessage` returns the platform message ID (`string|undefined`)
for reply threading. `ChannelOpts` supplies `isRoutedJid(jid)`
(DB routes lookup) so channels can filter unregistered JIDs.

### web-proxy.ts

HTTP server in front of Vite. Routes slink endpoints (`/pub/s/:token`,
`/_sloth/stream`, `/_sloth/message`), dashboard requests (`/dash/*`),
and proxies everything else to Vite. Auth boundary: `/pub/` and
`/_sloth/` bypass basic auth; `/dash/` requires auth.

### dashboards/index.ts

Dashboard portal with self-registration. `/dash/` renders an index
of registered dashboards. Each dashboard calls `registerDashboard()`
with name, title, description, and handler. Handler receives
`DashboardContext` (queue + channels) and the sub-path.

Built-in: status dashboard at `/dash/status/` -- shows gateway
uptime, memory, channels, groups, containers (cached 5s via
`docker ps`), queue state (`getStatus()`), scheduled tasks.
JSON API at `/dash/status/api/state`, HTML auto-refreshes every 10s.

### mime.ts + mime-enricher.ts + mime-handlers/

Attachment pipeline. Downloads attachments in parallel, runs
enrichment handlers (whisper transcription, video audio extraction),
returns annotation lines for the agent prompt.

### container-runner.ts

Spawns docker containers per agent invocation. Builds tier-aware
volume mounts, writes `start.json` to IPC dir (prompt + secrets),
reads JSON output from stdout between sentinel markers
(`---NANOCLAW_OUTPUT_START/END---`).
Output: `{ status, result, newSessionId, error }`.

Writes `groups.json` and `tasks.json` snapshots into group IPC
directory before each run. `_spawnProcess` is a test seam.

### container-runtime.ts

Docker lifecycle management. Starts/stops containers, cleans up
orphaned containers on startup. Orphan detection filters by
`ancestor=containerImage` to catch subagent containers spawned
by agent-team runs. Provides `readonlyMountArgs` for constructing
docker volume flags.

### group-queue.ts

Per-group message queue. Ensures sequential agent invocations
per group (no concurrent runs for the same group). Follow-up
messages are written to IPC input files, not piped via stdin.
Circuit breaker trips after 3 consecutive failures per group
(reset by next user message). Cross-channel preemption: if a
different JID needs the same folder, idle containers are closed.

### group-folder.ts

Resolves and validates group folder paths. Validates: no `..`,
no `\`, no absolute paths, non-empty segments ≤128 chars.
Used before volume mounts and IPC paths.

### router.ts

Message formatting and outbound routing. `formatMessages()`
emits `<messages>` XML with per-message attributes (`sender`,
`sender_id`, `chat_id`, `chat`, `platform`, `time`, `ago`).
`clockXml()` emits a `<clock>` header (UTC time + timezone),
prepended once per agent invocation.

`isAuthorizedRoutingTarget(source, target)` validates that target
is a direct child of source within the same world (root segment).
`resolveRoutingTarget(msg, rules)` evaluates routing rules against
a message (tier order: command, pattern, keyword, sender, default).
Route targets support RFC 6570 `{sender}` templates — expanded at
routing time to create per-sender child folders (auto-threading).

Outbound message delivery tracks `lastSentId` per chunk sequence
for reply-threading on platforms that support it. `delegatePerSender`
batches messages by sender before forwarding to child groups.
Escalation responses via `local:` JIDs are wrapped with
`<escalation_origin>` XML carrying the origin JID and messageId.

### grants.ts

Action-level permission system. Rules use glob syntax with param
matching (`send_message(platform=telegram)`). `parseRule` parses,
`checkAction` evaluates, `matchingRules`/`narrowRules` filter.
DB-backed overrides in `grants` table. Tier defaults: 0=`*`,
1=world-scoped social+messaging, 2=own-platform social+messaging,
3=`send_reply` only. Parent rules narrow child grants via
`deriveRules` delegation in `start.json`. Enforced in
container-runner (manifest filtering) and IPC (action dispatch).

### action-registry.ts + actions/

Unified action system. Each action has name, Zod schema, handler,
and optional command/MCP flags. Single source of truth for IPC
dispatch, MCP tools, and commands. `ActionContext` carries
`messageId` for reply threading on delegation; `send_message`
and `send_reply` return the sent message ID.

### ipc.ts

File-based IPC between gateway and agent containers. Agent writes
to `requests/`, gateway dispatches through action registry, writes
reply to `replies/`. Enables typed responses and tool discovery.
File sends serialized per group via drain lock.

### task-scheduler.ts

Cron-based scheduled task runner. Reads tasks from DB, fires
agent invocations at scheduled times. Uses `cron-parser` for
expression evaluation.

### mount-security.ts

Validates additional volume mounts requested by agents against
an allowlist at `~/.config/nanoclaw/mount-allowlist.json`.
Allowlist stored outside project root to prevent tampering.

## Container Model

Each agent invocation runs in a docker container. Containers
persist between messages (idle timeout) -- follow-up messages
arrive via IPC files, not new containers.

```
docker run
  -v groups/<folder>:/home/node          # home + cwd (rw; tier 3: ro)
  -v groups/<folder>/CLAUDE.md:ro        # tier 2+3: setup files locked
  -v groups/<folder>/.claude/skills:ro   # tier 2+3: skills locked
  -v groups/<folder>/.claude/projects:rw # tier 3: RW overlay
  -v groups/<folder>/media:rw            # tier 3: RW overlay
  -v groups/<folder>/tmp:rw              # tier 3: RW overlay
  -v GROUPS_DIR:/home/node/groups        # tier 0 only: cross-group access
  -v kanipi/:/workspace/self             # kanipi source (ro, tier 0 only)
  -v share/:/workspace/share             # cross-group shared state (ro tier 2+3)
  -v web/:/workspace/web                 # web output (rw, tier 0/1 only)
  -v data/ipc/<folder>:/workspace/ipc    # IPC directory (rw)
  -v <additional>:/workspace/extra/...   # allowlisted mounts (ro)
  -v app/container/agent-runner/src:/app/src  # agent-runner source (live)
```

The group folder IS the agent's home directory (`/home/node`).
SDK state (`.claude/`), diary, media, and child group folders all
live inside it. Workspace mounts (`self`, `share`, `web`, `ipc`,
`extra`) are separate plumbing directories.

**Tier-based mount permissions**: tier 0 (root) gets full RW
everywhere plus `~/groups` for cross-group sync. Tier 1 (world
admin) gets RW home and share. Tier 2 gets RW home but setup
files (CLAUDE.md, SOUL.md, `.claude/skills`, `settings.json`,
`output-styles`) are locked RO via more-specific overlays. Tier 3
gets RO home with explicit RW overlays for `.claude/projects`,
`media`, and `tmp` only.

**Agent I/O**: gateway writes `start.json` to the IPC directory
before spawn (contains prompt, session ID, secrets). Container
stdin is closed immediately -- all input is file-based. Agent
reads `start.json` (deletes after reading for security), runs
the SDK query, writes JSON output to stdout between sentinel
markers (`---NANOCLAW_OUTPUT_START/END---`). Follow-up messages
arrive as JSON files in `/workspace/ipc/input/`; gateway sends
SIGUSR1 to wake the agent (fallback: 500ms poll).

The agent-side MCP server (`ipc-mcp-stdio.ts`) exposes gateway
actions as tools via request-response IPC (writes to `requests/`,
polls `replies/`). Agent-written `mcpServers` entries in
`settings.json` are merged with the built-in server at spawn time.

A `<clock>` header (UTC time + timezone) is prepended to the
initial prompt, followed by system messages (new-session, new-day)
flushed from DB as XML, then user messages.

**reset_session IPC**: agents can request a session reset via IPC
(`type:'reset_session'`). The gateway evicts the current session
and the next invocation starts fresh.

**Skills seeding**: on first spawn for a group, `container/skills/`
is seeded to `~/.claude/skills/` inside the container. Includes
kanipi-specific skills plus development skills bundled from
kronael/tools (bash, go, python, typescript, etc.). A `CLAUDE.md`
is also seeded alongside.

**Soul**: agent personality is defined by `SOUL.md` in the group
folder (which IS `/home/node/`). The agent-runner checks
`/home/node/SOUL.md` and appends a persona nudge to the system prompt.

**SYSTEM.md**: `SYSTEM.md` in the group folder replaces the entire
Claude Code default system prompt (`systemPrompt` string instead of
`claude_code` preset). SOUL.md is auto-appended when both present.
Used for user-facing groups where developer-style output is unwanted.

**Migration system**: `container/skills/self/MIGRATION_VERSION`
tracks the applied version number. `container/skills/self/migrations/`
contains numbered migration files (`NNN-desc.md`). The `/migrate`
skill syncs all groups from the canonical source when the version
changes.

**Signal-driven IPC**: gateway writes IPC file then sends SIGUSR1;
agent wakes immediately rather than waiting for 500ms poll.

**`error_max_turns` recovery**: resumes with `maxTurns=3`, asks
Claude to summarise progress, prompts user to say "continue".

**`<internal>` tag stripping**: agent-runner strips `<internal>`
blocks from output before sending to channel users.

## Memory System

Seven memory layers, split into push (gateway-injected) and pull
(agent-searched).

### Push layers

| Layer        | Storage               | Injection                                  |
| ------------ | --------------------- | ------------------------------------------ |
| Messages     | SQLite                | recent N as `<messages>` XML on stdin      |
| Session      | SDK JSONL (`.jl`)     | Claude Code `--resume`                     |
| Managed      | CLAUDE.md + MEMORY.md | Claude Code native read                    |
| Diary        | `diary/*.md`          | 14 most recent as `<diary>` XML            |
| User context | `users/*.md`          | `<user>` pointer per message sender        |
| Episodes     | `episodes/*.md`       | most recent day/week/month as `<episodes>` |

### Pull layers

| Layer | Storage      | Search                                      |
| ----- | ------------ | ------------------------------------------- |
| Facts | `facts/*.md` | `/recall` (v1 grep or v2 CLI)               |
| All   | all stores   | `/recall` across facts/diary/users/episodes |

### Knowledge stores

All file-based stores follow one pattern: markdown files with
`summary:` YAML frontmatter. Four stores: `facts/`, `diary/`,
`users/`, `episodes/`. Adding a store = adding a directory name.

### Recall

`/recall` skill searches across all knowledge stores.

- **v1** (corpus < ~300 files): Explore subagent greps `summary:`
  across store dirs, LLM judges relevance.
- **v2** (corpus > ~300 files): `recall` CLI tool with FTS5 +
  sqlite-vec hybrid search. Per-store SQLite DBs in
  `.local/recall/`. Lazy mtime-based indexing, Ollama embeddings
  (`nomic-embed-text`, 768-dim), RRF fusion (0.7 vector, 0.3 BM25).
  Agent expands query into ~10 terms, calls `recall "term"` for
  each, then spawns Explore to judge scored candidates.

Config: `.recallrc` (TOML) in group folder, stores defined as
`[[store]]` entries.

### Progressive compression

`/compact-memories` skill compresses session transcripts and diary
entries into progressive summaries, scheduled via cron:

```
.claude/projects/-home-node/*.jl → episodes/YYYYMMDD.md (day) 0 2 * * *
daily episodes → episodes/YYYY-Wnn.md   (week)    0 3 * * 1
weekly episodes → episodes/YYYY-MM.md   (month)   0 4 1 * *
diary daily    → diary/week/YYYY-Wnn.md            0 3 * * 1
diary weekly   → diary/month/YYYY-MM.md            0 4 1 * *
```

Runs in isolated containers (no session history). Each compressed
file tracks `sources:` for traceability. Gateway injects episode
summaries; diary week/month exist for `/recall` only.

## Multi-instance Architecture

Each instance is independent: own data dir, agent image tag, and
systemd service. Instances can run different agent image versions.

```
/srv/data/kanipi_foo/           data dir (.env, store/, groups/, data/)
kanipi-agent-foo:latest         agent image (CONTAINER_IMAGE in .env)
kanipi_foo.service              systemd unit
```

## State

All gateway state in SQLite: `messages`, `groups`, `routes`,
`session_history`, `system_messages`, `scheduled_tasks`,
`task_run_logs`, `email_threads`, `auth_users`, `auth_sessions`.
WhatsApp auth: `store/auth/` (baileys format). Agent knowledge
stores: filesystem (`facts/`, `diary/`, `users/`, `episodes/`).

## External Systems

| System   | Library       | Role                                       |
| -------- | ------------- | ------------------------------------------ |
| Telegram | grammy        | message channel                            |
| WhatsApp | baileys       | message channel                            |
| Discord  | discord.js    | message channel                            |
| Email    | IMAP/SMTP     | message channel (IDLE + reply threading)   |
| Docker   | child_process | agent container runtime                    |
| Claude   | claude-code   | agent (runs in container)                  |
| Whisper  | fetch (HTTP)  | voice/video transcription (kanipi-whisper) |
