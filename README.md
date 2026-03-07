# kanipi

Multitenant Claude agent gateway. Routes messages from any channel
(Telegram, WhatsApp, Discord, Email, Web) to containerized Claude
Code agents. systemd-managed instances, MCP sidecar extensibility.

## Why

Build on the newest, fastest-moving ecosystem. Claude Code ships
weekly with new capabilities — subagents, tool use, skills, memory,
MCP. Every improvement lands in your agents for free. Betting on
a fast-moving foundation means compounding returns: today's agent
is better than yesterday's without touching your code.

Reusability and modularity aren't aesthetic choices — they're
survival. When the ecosystem moves fast, components that can't be
swapped get left behind. A monolithic agent framework locks you
into today's assumptions. Orthogonal components let you replace
one piece (the LLM, the channel, the memory layer) when a better
option arrives tomorrow.

## Principles

**Claude Code is the runtime** — full SDK, not a wrapper. Agents
get subagents, tool use, skills, CLAUDE.md, MEMORY.md, MCP servers
out of the box. The gateway orchestrates; the agent develops.

**Minimal and orthogonal** — each subsystem (channels, memory, IPC,
scheduling) has the narrowest possible responsibility. Like Postfix:
each component operates on a clean interface, knows nothing of the
others. Complexity is a liability.

**Products are configurations** — a product is a group with specific
CLAUDE.md (behavior), SOUL.md (persona), skills (capabilities),
mounts (data), and tasks. The gateway runs groups, not products.

**Components swap independently** — channels, memory layers, IPC,
container runtime, storage all have clean interfaces. When something
better arrives, swap one piece without touching the rest.

**Knowledge layers are the extension point** — push layers (diary,
user context) for small corpora injected by gateway. Pull layers
(facts, codebase) for large corpora searched by agent. New memory
types plug into the same pattern.

**Extensibility over speed** — don't optimize for performance
unless measured. Agent self-extension (skills, MCP servers,
CLAUDE.md, memory) is the primary extension mechanism.

## Products

A product is a kanipi instance configured for a specific role.
Same gateway, different CLAUDE.md + skills + mounts + persona.

**Atlas** — code support agent. Mounted repos + facts directory.
Agent searches code, researches via subagents, answers questions.
Configuration: CLAUDE.md with support persona, facts/ for
knowledge base, refs/ for mounted codebases, /facts skill for
deep research.

**Yonder** — research associate and knowledge mapper. Message from
phone, agent researches topics, builds knowledge pages, maps
connections. Vite serves results live.

**Evangelist** — shills own work and supports the community.
Engages in relevant conversations, explains products, answers
questions in external channels. Like a developer advocate bot.
(spec only)

**Cheerleader** — viral mining and community growth. Finds
high-signal conversations, amplification opportunities, trending
topics. Pure discovery and engagement mining. (spec only)

### How products work

```
kanipi instance = gateway + channel tokens + groups
product         = group config (CLAUDE.md + SOUL.md + skills + mounts)
```

The gateway doesn't know "atlas" or "evangelist" — it runs
groups. Each group's CLAUDE.md defines the agent's behavior,
persona, and capabilities. To create a new product, configure
a new group with appropriate instructions and skills.

## Quick Start

```bash
make image                     # build gateway docker image
make -C container image        # build agent docker image
make -C sidecar/whisper image  # build whisper sidecar image
./kanipi create foo            # seed instance at /srv/data/kanipi_foo/
```

Edit `/srv/data/kanipi_foo/.env` with channel tokens,
register the main group, and start:

```bash
./kanipi config foo group add tg:-123456789  # register main group
./kanipi foo                                 # start gateway
```

## Group Management

Groups must be registered before the bot processes messages.

```bash
kanipi config <instance> group list               # registered + discovered
kanipi config <instance> group add <jid> [folder] # register group
kanipi config <instance> group rm  <jid>          # unregister (not main)
```

First group added defaults to folder `main` with direct mode
(no trigger required). Subsequent groups require a folder name
and use trigger mode (`@assistant_name` to activate).

## Web Channel (slink)

Groups with a slink token accept messages via HTTP:

```bash
POST /pub/s/<token>
Content-Type: application/json

{"text": "hello", "media_url": "https://example.com/file.mp3"}
```

Optional `Authorization: Bearer <jwt>` header. When `AUTH_SECRET` is set,
JWTs are verified (HMAC-SHA256). Authenticated requests get a higher rate
limit (`SLINK_AUTH_RPM`, default 60/min vs `SLINK_ANON_RPM` default 10/min).

`/pub/sloth.js` is a client-side script for embedding in public web pages
(reads `data-token` from script tag). The authenticated `/_sloth/sloth.js`
is injected into all proxied HTML pages and adds a `POST /_sloth/message`
handler plus a SSE stream at `/_sloth/stream?group=<name>` for receiving
agent responses in-page.

## System Messages and Sessions

The gateway injects system messages (new-session, new-day) as XML
prepended to agent stdin. Messages are enqueued in the `system_messages`
DB table and flushed on the next agent invocation for the group.

Every container spawn/exit is recorded in the `session_history` table. On
agent error, the user receives a retry prompt and the session cursor rolls
back so the next run starts fresh. New-session injection includes the last
2 previous sessions as `<previous_session>` XML elements.

## Commands

Slash commands (`/new`, `/ping`, `/chatid`) are handled by a pluggable
registry in `src/commands/`. Commands are intercepted before the message
reaches the agent. The registry is exported as `commands.xml` into each
group's IPC directory so agents can discover available commands.

## Routing

Groups support hierarchical parent-child delegation. A parent group
can delegate messages to child groups based on routing rules:

| Rule type | Match criteria                              |
| --------- | ------------------------------------------- |
| command   | message starts with trigger string          |
| pattern   | message matches regex (max 200 char)        |
| keyword   | message contains keyword (case-insensitive) |
| sender    | sender name matches regex                   |
| default   | fallback when no other rule matches         |

Rules are evaluated in tier order (command, pattern, keyword, sender,
default); first match within each tier wins. Delegation is authorized
only for direct parent-to-child relationships within the same world
(same root folder segment), capped at depth 3.

Set via `set_routing_rules` action; delegate via `delegate_group` action.

## MCP Sidecars

Per-group MCP servers run as sidecar containers alongside the agent.
Configure via `SIDECAR_<NAME>_IMAGE` env vars (e.g. `SIDECAR_WHISPER_IMAGE`).

Per-group sidecar config is stored in `container_config.sidecars` on
`registered_groups`. Sidecars communicate via Unix sockets at
`/workspace/ipc/sidecars/<name>.sock`. The gateway starts sidecars
before the agent, probes readiness, and merges them into the agent's
`settings.json` as MCP servers.

## Instance Layout

`/srv/data/kanipi_<name>/`:

```
.env                    config (tokens, ports)
store/                  SQLite DB, whatsapp auth
groups/main/logs/       conversation logs
data/sessions/          per-session state dirs
data/ipc/               agent IPC files
web/pub/                public web files (no auth)
web/priv/               private web files (auth required)
```

The `/pub/` URL prefix is the auth boundary: files under `web/pub/`
are served without authentication, `web/priv/` requires auth.
Agent skills are seeded from `container/skills/` to
`~/.claude/skills/` inside each container on first spawn.

## Config

All via `.env` (seeded from `template/env.example`):

| Key                       | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| ASSISTANT_NAME            | instance name                                 |
| TELEGRAM_BOT_TOKEN        | enables telegram channel                      |
| DISCORD_BOT_TOKEN         | enables discord channel                       |
| CONTAINER_IMAGE           | agent docker image                            |
| CLAUDE_CODE_OAUTH_TOKEN   | passed to agent containers                    |
| IDLE_TIMEOUT              | container idle shutdown (ms)                  |
| MAX_CONCURRENT_CONTAINERS | concurrent agent limit                        |
| VITE_PORT                 | enables vite web serving                      |
| WEB_HOST                  | vite host binding                             |
| SLOTH_USERS               | basic auth users (alice:pw,bob:pw2)           |
| AUTH_SECRET               | HMAC secret for JWT verification (slink)      |
| WHISPER_BASE_URL          | whisper sidecar URL for transcription         |
| EMAIL_IMAP_HOST           | enables email channel (IMAP IDLE)             |
| EMAIL_SMTP_HOST           | SMTP for reply threading (defaults from IMAP) |
| EMAIL_ACCOUNT             | email account address                         |
| EMAIL_PASSWORD            | email account password                        |
| MEDIA_ENABLED             | enable attachment pipeline (default false)    |
| SIDECAR\_\*\_IMAGE        | per-name sidecar docker image                 |
| TIMEZONE                  | cron timezone (validated, fallback UTC)       |

Channels enabled by token presence (telegram/discord),
auth dir existence (whatsapp: `store/auth/creds.json`),
or `EMAIL_IMAP_HOST` presence (email).

Per-group whisper language hints: create `.whisper-language` in the group
folder with one BCP-47 language code per line (e.g. `cs`, `de`). The whisper
handler runs one additional forced-decode pass per language and labels each
result separately alongside the auto-detected pass.

## Deployment

Run directly with docker:

```bash
docker run -d -i --name kanipi_foo \
    --network=host \
    -v /srv/data/kanipi_foo:/srv/app/home \
    -v /srv/run/kanipi_foo:/srv/run/kanipi_foo \
    -v /var/run/docker.sock:/var/run/docker.sock \
    kanipi foo
```

Or with systemd — create `/etc/systemd/system/kanipi_foo.service`:

```ini
[Unit]
Description=kanipi foo
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=1
ExecStartPre=-/usr/bin/docker stop %n
ExecStartPre=-/usr/bin/docker rm -f %n
ExecStop=/usr/bin/docker rm -f %n
ExecStart=/usr/bin/docker run -i --rm --name %n \
    --network=host \
    -v /srv/data/kanipi_foo:/srv/app/home \
    -v /srv/run/kanipi_foo:/srv/run/kanipi_foo \
    -v /var/run/docker.sock:/var/run/docker.sock \
    kanipi foo

[Install]
WantedBy=default.target
```

Then `systemctl enable --now kanipi_foo`.

## Development

```bash
make build          # tsc compile (src/ -> dist/)
make lint           # typecheck without emitting
make test           # all tests (vitest run src/ + tests/e2e/)
npm run dev         # tsx dev mode
```

Pre-commit hooks: prettier (single quotes), typecheck, hygiene.
