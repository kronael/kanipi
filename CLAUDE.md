# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Conversation Startup Protocol

ALWAYS follow before answering:

1. **Get context** — ALWAYS read `.diary/` recent entries on startup.
   ALWAYS read the previous session `.jl` transcript when the gateway
   injects a `<previous_session id="...">` tag. Use `Glob` to find
   `~/.claude/projects/-home-node/*.jl`, then `Read` the matching file.
   Understand what happened before responding.
2. **Enough context?** — if not, ask or explore further. NEVER
   guess what was decided in a prior session. NEVER claim "no access
   to session history" without first reading the `.jl` file.
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
make agent-image               # agent docker image
npm run dev         # tsx dev mode
```

Tests use vitest (devDependency):
`make test` — unit+e2e (src/ + tests/e2e/).
`make smoke` — all tests. `make integration` — docker-dependent tests.
Run one file: `bunx vitest run src/foo.test.ts`.

Pre-commit hooks (prettier, typecheck, hygiene) configured
via `.pre-commit-config.yaml`. Prettier uses single quotes.

## Architecture

See `ARCHITECTURE.md` for full details. Key facts:

- TypeScript (ESM, NodeNext), SQLite, Docker
- Flow: Channel → DB → message loop → GroupQueue → docker run → stream back
- Group folder mounts as `/home/node` (agent's home + cwd)
- IPC: gateway writes `start.json` + SIGUSR1 signal, agent polls `/workspace/ipc/input/`
- Agent output: `<think>` blocks stripped, `<status>` blocks sent as interim updates
- Docker-in-docker: `HOST_GROUPS_DIR`, `HOST_DATA_DIR`, `HOST_APP_DIR` for path translation

## Layout

```
src/                  gateway source (TypeScript)
  cli.ts              CLI entrypoint (config/create/run commands)
  dashboards/         dashboard portal (/dash/ with self-registration)
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

Specs in `specs/<phase>/` with base58 prefixes for sort order.
`specs/index.md` is the master index. Phase 1-2 shipped, 3 in
progress, 4-5 planned. Naming: `<phase>/<base58>-<topic>.md`.

## Data Dir

`/srv/data/kanipi_<name>/`: `.env`, `store/` (SQLite, whatsapp auth),
`groups/` (per-group folders), `web/` (vite app), `data/` (IPC).

## Config

All config via `.env` in data dir or env vars. `env.ts` loads raw
`.env`; `config.ts` exports typed constants (always import from
`config.ts`). `CONTAINER_IMAGE` from `.env` or env var (env wins,
default `nanoclaw-agent:latest`). Channels enabled by token
presence (telegram/discord), auth dir (whatsapp), or
`EMAIL_IMAP_HOST` (email). See `README.md` for full config table.

## Entrypoint

CLI: `src/cli.ts` (run via `npx tsx src/cli.ts`). The bash `kanipi`
script at repo root works for production docker deployments.
`group add` creates DB+schema if missing. First group defaults to
folder=root, requires_trigger=0. See `README.md` for CLI reference.

## Design Philosophy

See `README.md` for principles. TL;DR: minimal, orthogonal,
Claude Code-native. Products are configurations.

## Multi-instance Deployment

Each instance runs independently with its own data dir, agent image,
and systemd service. Per-instance image tags allow independent upgrades.

```
/srv/data/kanipi_<name>/     data dir per instance
kanipi-agent-<name>:latest   agent image per instance
kanipi_<name>.service        systemd unit per instance
```

**Upgrade workflow** (selective per instance):

```bash
make agent-image                                    # build kanipi-agent:latest
sudo docker tag kanipi-agent:latest kanipi-agent-<name>:latest  # tag for instance
sudo systemctl restart kanipi_<name>                # restart only upgraded instances
```

Set `CONTAINER_IMAGE=kanipi-agent-<name>:latest` in each instance's
`.env`. Default is `nanoclaw-agent:latest` (config.ts fallback).

Gateway image follows the same pattern: `kanipi:latest` →
`kanipi-<name>:latest` per instance.

## Operational check (post-deploy)

```bash
sudo systemctl status kanipi_<instance>
sudo journalctl -u kanipi_<instance> --since "5 min ago" --no-pager | head -30
sudo journalctl -u kanipi_<instance> --since "5 min ago" | grep -iE 'error|fatal'
sudo docker ps --filter "name=nanoclaw-" --format "{{.Names}} {{.Status}}"
```

Red flags: `"Error in message loop"`, `"Container timeout with no output"`,
`"Max retries exceeded"`, `"Failed to parse container output"`, no log
activity >30s. Key error emitters: `index.ts`, `group-queue.ts`,
`container-runner.ts`, `ipc.ts`.

## Shipping changes (agent skills / web convention)

When making notable kanipi changes:

1. Add entry to `CHANGELOG.md`
2. Add migration file `container/skills/self/migrations/NNN-desc.md`
3. Update `container/skills/self/MIGRATION_VERSION` to match highest N
4. Update "Latest migration version" in `container/skills/self/SKILL.md`
5. Rebuild agent image

## Docs

Source of truth: `docs/kanipi.html` (deployed to krons.fiu.wtf/kanipi).
On version ship: edit `docs/kanipi.html`, copy to
`/srv/data/kanipi_krons/web/kanipi/index.html`.

## Tagging a new version

After all changes are committed:

1. Update `package.json` version
2. Update `CHANGELOG.md` — move [Unreleased] to `[vX.Y.Z] — YYYY-MM-DD`
3. Update `docs/kanipi.html` + deploy to krons
4. `git tag vX.Y.Z`
5. Tag docker images: `sudo docker tag kanipi:latest kanipi:vX.Y.Z` (same for kanipi-agent)
6. Per-instance tags: `sudo docker tag kanipi-agent:vX.Y.Z kanipi-agent-<name>:latest`
7. Add `.diary/YYYYMMDD.md` entry documenting what was deployed and which instances
