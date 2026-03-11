# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Conversation Startup Protocol

ALWAYS follow before answering:

1. **Get context** — read `.diary/` recent entries. If the user
   references past conversations or a JSONL transcript path, read
   those first. Understand what happened before responding.
2. **Enough context?** — if not, ask or explore further. NEVER
   guess what was decided in a prior session.
3. **Then act** — answer/execute the request with full context.

## Core Design Facts

- **Agent runtime is Claude Code** — full SDK with subagents,
  tool use, skills, CLAUDE.md, MEMORY.md. The gateway orchestrates;
  the agent develops.
- **Memory is Claude-centric, overridable** — MEMORY.md, diary,
  facts are all Claude Code native patterns. Gateway injects
  context but the agent owns its own memory. Products can
  override memory behavior via CLAUDE.md instructions.
- **Products are configurations** — a product is a group with
  specific CLAUDE.md, SOUL.md, skills, mounts, and tasks. The
  gateway runs groups, not products.
- See `README.md` for principles, `ROADMAP.md` for v1/v2/v3.

## Conventions

- JSONL files use `.jl` extension (not `.jsonl`)

## Format Conventions

- XML tags for prompt structure (context sections, examples)
- JSON for IPC, MCP, tool parameters, structured output
- See `specs/res/xml-vs-json-llm.md` for research

## What is kanipi

Nanoclaw fork — multitenant Claude agent gateway with
multi-channel support (telegram, whatsapp, discord, email).
systemd-managed instances, MCP extensibility.

## Build & Test

```bash
make build          # tsc compile (src/ → dist/)
make lint           # typecheck without emitting
make image                     # gateway docker image
make -C container image        # agent docker image
npm run dev         # tsx dev mode
```

Tests use vitest (devDependency). Run all:
`vitest run`. Run one file: `vitest run src/foo.test.ts`.
Many tests require docker — they'll fail without it.

Pre-commit hooks (prettier, typecheck, hygiene) configured
via `.pre-commit-config.yaml`. Prettier uses single quotes.

## Architecture

TypeScript (ESM, NodeNext). Gateway polls channels for
messages, routes to containerized Claude agents via docker.

**Flow**: Channel → DB (store message) → message loop polls
→ GroupQueue → runContainerCommand (docker run) → stream
output back to channel.

Key modules:

- `index.ts` — main loop, channel init, message routing
- `config.ts` — config from `.env` + env vars (no web config)
- `db.ts` — SQLite (better-sqlite3) for messages, state, tasks
- `container-runner.ts` — spawns agent containers (dual mode: agent ceremony vs raw bash), streams I/O
- `container-runtime.ts` — docker lifecycle, orphan cleanup
- `group-queue.ts` — per-group message queueing, stdin piping
- `router.ts` — message formatting, channel→JID resolution
- `action-registry.ts` — unified action system (Zod schemas, authorization)
- `actions/` — action handlers by domain (messaging, tasks, groups, session, inject)
- `ipc.ts` — container↔gateway IPC (request-response + legacy fire-and-forget)
- `task-scheduler.ts` — cron-based scheduled tasks
- `group-folder.ts` — folder validation and path resolution (prevents traversal)
- `mount-security.ts` — validates additional mounts against `~/.config/nanoclaw/mount-allowlist.json` (stored outside project to prevent agent tampering)
- `logger.ts` — pino logger (JSON in production, pino-pretty in dev)
- `mime.ts` — shared `mimeFromFile()` via file-type (magic bytes detection), `mediaLine()` for container-relative paths
- `channels/` — telegram (grammy), whatsapp (baileys), discord (discord.js),
  email (IMAP IDLE + SMTP threading)

**Web**: vite dev server managed by bash entrypoint (not
the TS gateway). No `web-server.ts` — web is external.

**Container model**: each agent runs in a docker container.
The group folder is mounted as `/home/node` (home + cwd).
`.claude/` state lives inside the group folder — one directory,
one mount. Agent reads prompt from stdin, writes results to
stdout as JSON. `container/agent-runner/` is the in-container
entrypoint. IPC is signal-driven: gateway writes a file then
sends SIGUSR1 to the container; agent wakes immediately on
signal, falls back to 500ms poll.

**Docker-in-docker path translation**: when the gateway itself
runs in docker, `process.cwd()` paths are container-internal.
`config.ts:detectHostPath()` reads `/proc/self/mountinfo` to
find the host-side path of `PROJECT_ROOT` so child containers
receive correct host mount paths. Mount paths use explicit
`HOST_GROUPS_DIR`, `HOST_DATA_DIR`, and `HOST_APP_DIR` exports
from config. `chownRecursive()` ensures they are writable by
node uid 1000 inside agent containers.

## Layout

```
src/                  gateway source (TypeScript)
  cli.ts              CLI entrypoint (config/create/run commands)
container/            agent container build
  agent-runner/       in-container agent entrypoint
  build.sh            agent image builder
  skills/             agent-side skills
prototype/            seed for new instances
  .claude/CLAUDE.md   default group CLAUDE.md (group-chat behavior instructions)
kanipi                bash entrypoint (legacy, for docker deployments)
specs/                design specs (see below)
```

## Specs

Specs live in `specs/` organized by phase. Each milestone
gets its own phase directory. Files use base58 prefixes
(0-9, A-H, J-N, P-Z, a-k, m-z) for stable sort order.

```
specs/1/   phase 1 — core gateway (shipped)
specs/2/   phase 2 — social channels (shipped)
specs/3/   phase 3 — permissions, cleanup, gaps (in progress)
specs/4/   phase 4 — dashboards, memory, products (planned)
specs/5/   phase 5 — agent extensions & workflows (future)
specs/6/   phase 6+ — products (deferred)
specs/res/ resources (examples, research)
```

Naming: `<phase>/<base58>-<topic>.md` e.g. `1/0-actions.md`,
`2/5-permissions.md`. `specs/INDEX.md` is the master index of all specs with status.
The user controls releases and tags — TODO.md may suggest which specs
a version should cover, but the user decides what ships when.

## Data Dir

`/srv/data/kanipi_<name>/` per instance:

- `.env` — config (gateway reads from cwd)
- `store/` — SQLite DB, whatsapp auth
- `groups/main/logs/` — conversation logs
- `web/` — vite web app (seeded from template/web/)
- `data/` — IPC

## Config

All config via `.env` in data dir or env vars. Key values:
`ASSISTANT_NAME`, `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`,
`EMAIL_IMAP_HOST`, `EMAIL_SMTP_HOST`, `EMAIL_ACCOUNT`, `EMAIL_PASSWORD`,
`CONTAINER_IMAGE`, `IDLE_TIMEOUT`, `MAX_CONCURRENT_CONTAINERS`.

`CONTAINER_IMAGE` is read from both `.env` and env vars (env var
wins). Most other container settings are env-var only.

`env.ts` handles raw `.env` file loading; `config.ts` exports
typed constants derived from env. Always import from `config.ts`.

Channels enabled by token presence (telegram/discord), auth dir existence
(whatsapp), or `EMAIL_IMAP_HOST` presence (email).

## Entrypoint

CLI implemented in TypeScript (`src/cli.ts`), run via `npm run cli` or
`npx tsx src/cli.ts`. The bash `kanipi` script at repo root is legacy
but still works for production docker deployments.

```bash
kanipi create <name>                      # seed data dir, .env, systemd unit
kanipi config <instance> group list       # list registered/discovered groups
kanipi config <instance> group add [folder]        # register a group (folder only)
kanipi config <instance> group rm <folder>         # unregister (keeps folder on disk)
kanipi config <instance> user list|add|rm|passwd   # manage web auth users
kanipi config <instance> mount list|add|rm         # manage container mounts
kanipi <instance>                         # run gateway + vite
```

Legacy shorthand: `kanipi <instance> group ...` (same as `config <instance> group`).

`group add` creates the DB + schema if missing (solves bootstrap).
First group defaults to folder=root, requires_trigger=0.
Subsequent groups require folder arg and use trigger mode.

## Related projects

- `/home/onvos/app/eliza-atlas` — ElizaOS fork with deep facts/memory system;
  the evangelist plugin (`/home/onvos/app/eliza-plugin-evangelist`) implements
  YAML-based facts repository, vector search, and Claude Code-powered research.
  This is the reference implementation for kanipi's v2 facts/long-term memory.
  Key files: `src/services/factsService.ts`, `src/services/researchService.ts`
- `/home/onvos/app/refs/brainpro` — brainpro agent (Rust/gateway); reference
  for `memory/YYYY-MM-DD.md` daily notes pattern and session map design

## Design Philosophy

See `README.md` for full principles. TL;DR: minimal, orthogonal,
Claude Code-native. Components swap independently. Products are
configurations. Extensibility over speed.

## Operational check (post-deploy)

After deploying a new version, run this check sequence:

```bash
# 1. Service health — should be active (running), no restart loops
sudo systemctl status kanipi_<instance>

# 2. Startup sequence — expect these lines in order:
#    "Database initialized", "State loaded", "<channel> connected",
#    "IPC watcher started", "Scheduler loop started", "NanoClaw running"
sudo journalctl -u kanipi_<instance> --since "5 minutes ago" --no-pager | head -30

# 3. Errors/warnings — should return nothing
sudo journalctl -u kanipi_<instance> --since "5 minutes ago" --no-pager \
  | grep -iE 'error|warn|fatal|crash|unhandled|reject'

# 4. Container orphans — nanoclaw-* containers >1h old are suspect
sudo docker ps --filter "name=nanoclaw-" --format "{{.Names}} {{.Status}}"

# 5. IPC file accumulation — request files should drain, not pile up
find /srv/data/kanipi_<instance>/data/ipc/*/requests/ -name '*.json' 2>/dev/null | wc -l
```

Red flags in journalctl:

- `"Error in message loop"` — unhandled error, likely repeating
- `"Container timeout with no output"` — agent hung
- `"Max retries exceeded, dropping messages"` — persistent failure
- `"Failed to parse container output"` — agent output malformed
- No log activity for >30s — message loop stalled

When investigating issues, correlate journalctl timestamps with
source code error paths. Key error emitters: `index.ts` (message
loop), `group-queue.ts` (retry/concurrency), `container-runner.ts`
(spawn/timeout), `ipc.ts` (drain errors).

## Shipping changes (agent skills / web convention)

When making notable kanipi changes:

1. Add entry to `CHANGELOG.md`
2. Add migration file `container/skills/self/migrations/NNN-desc.md`
3. Update `container/skills/self/MIGRATION_VERSION` to match highest N
4. Update "Latest migration version" in `container/skills/self/SKILL.md`
5. Rebuild agent image

## Docs

Product docs live at krons.fiu.wtf/kanipi. Source of truth:
`/srv/data/kanipi_krons/web/kanipi/index.html`. Local copy
kept in sync at `docs/kanipi.html`.

When shipping a new version, update both:

1. Edit `docs/kanipi.html` (version, stats, features, LLM context)
2. Copy to `/srv/data/kanipi_krons/web/kanipi/index.html`

## Tagging a new version

After all changes are committed:

1. Update `package.json` version
2. Update `CHANGELOG.md` — move [Unreleased] to `[vX.Y.Z] — YYYY-MM-DD`
3. Update `docs/kanipi.html` + deploy to krons
4. `git tag vX.Y.Z`
5. Tag docker images: `docker tag kanipi:latest kanipi:vX.Y.Z` and same for `kanipi-agent`
6. Per-instance gateway tags: `docker tag kanipi:vX.Y.Z kanipi-<name>:latest` for instances being upgraded
7. Add `.diary/YYYYMMDD.md` entry documenting what was deployed and which instances
