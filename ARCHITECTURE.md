# Architecture

## Overview

Kanipi is a multitenant Claude agent gateway. It polls messaging
channels for new messages, routes them to containerized Claude
agents via docker, and streams responses back to users.

TypeScript (ESM, NodeNext), SQLite (better-sqlite3), Docker.

## Message Flow

```
Channel (telegram/whatsapp/discord/email)
  -> DB (store message + chat metadata)
  -> message loop (poll getNewMessages)
  -> trigger check (direct mode or @name mention)
  -> routing rules (resolveRoutingTarget: delegate to child group if matched)
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

### channels/

One file per channel. Each implements `Channel` interface:

- `telegram.ts` — grammy bot, polls via webhook or long-poll
- `whatsapp.ts` — baileys client, event-driven
- `discord.ts` — discord.js client, event-driven
- `email.ts` — IMAP IDLE + SMTP reply threading

Each channel stores incoming messages via `storeMessage` and
provides `sendMessage(jid, text)` for outbound delivery.
`ChannelOpts` supplies `isRoutedJid(jid)` (DB routes lookup)
and `hasAlwaysOnGroup()` (any group with `requires_trigger=0`)
so channels can decide whether to filter unregistered JIDs.

### web-proxy.ts

HTTP server in front of Vite. Routes slink endpoints (`/pub/s/:token`,
`/_sloth/stream`, `/_sloth/message`), proxies everything else to Vite.
Auth boundary: `/pub/` and `/_sloth/` bypass basic auth.

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
prepended once per agent invocation. Strips `<internal>` tags
from agent output before sending to channel users.

`isAuthorizedRoutingTarget(source, target)` validates that target
is a direct child of source within the same world (root segment).
`resolveRoutingTarget(msg, rules)` evaluates routing rules against
a message (tier order: command, pattern, keyword, sender, default).
Route targets support RFC 6570 `{sender}` templates — expanded at
routing time to create per-sender child folders (auto-threading).

### action-registry.ts + actions/

Unified action system. Each action has name, Zod schema, handler,
and optional command/MCP flags. Single source of truth for IPC
dispatch, MCP tools, and commands.

### ipc.ts

File-based IPC between gateway and agent containers. Two modes:

1. **Request-response** (new): agent writes to `requests/`,
   gateway dispatches through action registry, writes reply to
   `replies/`. Enables typed responses and tool discovery.
2. **Fire-and-forget** (legacy): agent writes to `messages/`
   or `tasks/`, gateway drains and executes. Kept for backwards
   compat during rollout.

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

**Migration system**: `container/skills/self/MIGRATION_VERSION`
tracks the applied version number. `container/skills/self/migrations/`
contains numbered migration files (`NNN-desc.md`). The `/migrate`
skill syncs all groups from the canonical source when the version
changes.

**Signal-driven IPC**: gateway writes IPC file then sends SIGUSR1
to the container; agent wakes immediately on signal rather than
waiting for the 500ms poll interval.

**`error_max_turns` recovery**: resumes with `maxTurns=3`, asks
Claude to summarise progress, prompts user to say "continue".

## Multi-instance Architecture

Each kanipi instance is independent: own data dir, gateway
container, agent image tag, and systemd service. This allows:

- Independent upgrades per instance (tag agent image per instance)
- Isolated data and credentials per instance
- Different channel configurations per instance

```
/srv/data/kanipi_foo/           data dir (.env, store/, groups/, data/)
kanipi-agent-foo:latest         agent image (CONTAINER_IMAGE in .env)
kanipi_foo.service              systemd unit
```

Each instance can run a different agent image version. Build
once, tag per instance, restart only what you want to upgrade.

## State

- Registered groups → SQLite (`groups` table + `routes` table; routes map JIDs to target folders)
- Message history → SQLite (`messages` table)
- Sessions → SQLite (`session_history` table) + filesystem. On agent error, the DB
  pointer is evicted so the next run starts a fresh session; JSONL remains on
  disk for history.
- System messages → SQLite (`system_messages` table), flushed per invocation
- Scheduled tasks → SQLite (`scheduled_tasks` table), run logs in `task_run_logs`
- Email threads → SQLite (`email_threads` table) for SMTP reply threading
- Web auth users → SQLite (`auth_users` table)
- Web auth sessions → SQLite (`auth_sessions` table)
- WhatsApp auth → `store/auth/` (baileys format)

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

## Repository Layout

See CLAUDE.md Layout section.
