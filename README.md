# kanipi

Multitenant Claude agent gateway. Routes messages from any channel
(Telegram, WhatsApp, Discord, Email, Web) to containerized Claude
Code agents. systemd-managed instances, MCP extensibility.

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
user context, episodes) injected by gateway. Pull layers (facts,
all stores via `/recall`) searched by agent. Progressive compression
(`/compact-memories`) turns sessions into day/week/month summaries.
New memory types plug into the same pattern.

**Extensibility over speed** — don't optimize for performance
unless measured. Agent self-extension (skills, MCP servers,
CLAUDE.md, memory) is the primary extension mechanism.

## Products

A product is a kanipi instance configured for a specific role.
Same gateway, different CLAUDE.md + skills + mounts + persona.

**Support** — code support agent. Mounted repos, support persona,
and workspace knowledge files. Agent searches code, researches via
subagents, answers questions. Current configuration is CLAUDE.md +
skills + refs/ mounts. A dedicated `facts/` memory layer is still
planned, not shipped.

**Researcher** — research associate and knowledge mapper. Message from
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

## Prerequisites

- Node.js 22+ (with npm)
- Docker (for agent containers)
- bun (build tooling uses `bunx`)
- Anthropic credentials: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude login`)
  or `ANTHROPIC_API_KEY` (direct API key). Either works — OAuth token
  is recommended (higher rate limits, usage on your Claude plan)

## Quick Start

### Docker deployment (production)

Two images required: `kanipi` (gateway) and `kanipi-agent` (agent container).

```bash
make image         # build gateway docker image
make agent-image   # build agent docker image
./kanipi create foo                          # seed /srv/data/kanipi_foo/
edit /srv/data/kanipi_foo/.env               # set tokens
./kanipi config foo group add tg:-123456789  # register main group
./kanipi foo                                 # start gateway
```

### Standalone (bare metal / development)

```bash
npm install
make build                                   # tsc compile
npx tsx src/cli.ts create foo                # seed /srv/data/kanipi_foo/
edit /srv/data/kanipi_foo/.env               # set tokens
make agent-image                             # agent container still needs docker
npx tsx src/cli.ts config foo group add tg:-123456789
npm run dev                                  # or: npx tsx src/cli.ts run foo
```

### Path layout

All data lives under `${PREFIX}/data/kanipi_<name>/` where `PREFIX`
defaults to `/srv`. Override with `PREFIX=/home/user` to put data at
`/home/user/data/kanipi_foo/`. Individual paths can be overridden
in `.env` — see `template/env.example` for all options.

## How It Works

Gateway polls channels (Telegram, WhatsApp, Discord, Email) for
messages, queues them per group, and spawns a docker container per
agent invocation. The agent runs Claude Code (paid — each invocation
uses API credits), reads the message from stdin, uses tools/skills/MCP,
and writes results to stdout as JSON. The gateway streams responses
back to the originating channel.

Messages are queued per group — each group processes one message at
a time. `MAX_CONCURRENT_CONTAINERS` limits total parallel agents
across all groups (default 5). `CONTAINER_TIMEOUT` controls how long a
container stays alive between messages (default 60min) — longer
keeps context but uses more memory, shorter saves resources.
`<status>` blocks from the agent reset the idle timer.
When the gateway itself runs in docker, `HOST_DATA_DIR` must be
set so child agent containers get correct host-side mount paths.

The gateway needs docker socket access (`-v /var/run/docker.sock`)
because it spawns agent containers. The `-i` flag on `docker run`
keeps stdin open for the gateway's IPC model (stdin piping to agents).
Both are required.

## Group Management

Groups must be registered before the bot processes messages.

```bash
kanipi config <instance> group list               # registered + discovered
kanipi config <instance> group add <jid> [folder] # register group
kanipi config <instance> group rm  <jid>          # unregister (not main)
```

First group added defaults to folder `root`. Subsequent groups
require a folder name. All groups use `default` route type
(all messages processed).

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
is injected into proxied HTML pages and adds a `POST /_sloth/message`
handler plus a SSE stream at `/_sloth/stream?group=<name>` for receiving
agent responses in-page.

Current SSE behavior is group-broadcast: every listener attached to the same
group receives every response for that group. Sender-scoped SSE is not
implemented yet.

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
| command   | message starts with prefix string           |
| pattern   | message matches regex (max 200 char)        |
| keyword   | message contains keyword (case-insensitive) |
| sender    | sender name matches regex                   |
| default   | fallback when no other rule matches         |

Rules are evaluated in tier order (command, pattern, keyword, sender,
default); first match within each tier wins. Delegation is authorized
only for direct parent-to-child relationships within the same world
(same root folder segment), capped at depth 3.

Set via `set_routing_rules` action; delegate via `delegate_group` action.
Routing is parent-to-child by registered group folder. Glob-based JID routing
is not currently implemented.

## Instance Layout

`${PREFIX}/data/kanipi_<name>/` (PREFIX defaults to `/srv`):

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
Agent skills are seeded from `prototype/.claude/skills/` to
`~/.claude/skills/` inside each container on first spawn.

Current shipped auth is local-account session auth plus slink JWT
verification, and Google OAuth (`/auth/google`).

## Config

All via `.env` (seeded from `template/env.example`):

| Key                       | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| ASSISTANT_NAME            | instance name                                             |
| TELEGRAM_BOT_TOKEN        | enables telegram channel                                  |
| DISCORD_BOT_TOKEN         | enables discord channel                                   |
| CONTAINER_IMAGE           | agent docker image                                        |
| CLAUDE_CODE_OAUTH_TOKEN   | passed to agent containers                                |
| CONTAINER_TIMEOUT         | container idle shutdown (ms, default 3600000)             |
| MAX_CONCURRENT_CONTAINERS | concurrent agent limit                                    |
| VITE_PORT                 | enables vite web serving                                  |
| WEB_HOST                  | vite host binding                                         |
| AUTH_SECRET               | JWT secret for session auth (required for non-public web) |
| GITHUB_CLIENT_ID          | GitHub OAuth app client ID                                |
| GITHUB_CLIENT_SECRET      | GitHub OAuth app client secret                            |
| GOOGLE_CLIENT_ID          | Google OAuth app client ID                                |
| GOOGLE_CLIENT_SECRET      | Google OAuth app client secret                            |
| DISCORD_CLIENT_ID         | Discord OAuth app client ID                               |
| DISCORD_CLIENT_SECRET     | Discord OAuth app client secret                           |
| WEBDAV_ENABLED            | enable WebDAV proxy (default false)                       |
| WEBDAV_URL                | upstream WebDAV server URL                                |
| WHISPER_BASE_URL          | whisper service URL for transcription                     |
| EMAIL_IMAP_HOST           | enables email channel (IMAP IDLE)                         |
| EMAIL_SMTP_HOST           | SMTP for reply threading (defaults from IMAP)             |
| EMAIL_ACCOUNT             | email account address                                     |
| EMAIL_PASSWORD            | email account password                                    |
| MEDIA_ENABLED             | enable attachment pipeline (default false)                |
| TIMEZONE                  | cron timezone (validated, fallback UTC)                   |

Channels enabled by token presence (telegram/discord),
auth dir existence (whatsapp: `store/auth/creds.json`),
or `EMAIL_IMAP_HOST` presence (email).

**WhatsApp setup**: start the gateway without WhatsApp credentials.
It will print a QR code to the terminal. Scan it with WhatsApp on
your phone to pair. Credentials are saved to `store/auth/creds.json`
and reused on subsequent starts.

Per-group whisper language hints: create `.whisper-language` in the group
folder with one BCP-47 language code per line (e.g. `cs`, `de`). The whisper
handler runs one additional forced-decode pass per language and labels each
result separately alongside the auto-detected pass.

## Deployment

`./kanipi create <name>` generates a systemd unit file at
`${PREFIX}/data/kanipi_<name>/kanipi_<name>.service`. Copy it
to `/etc/systemd/system/` and enable:

```bash
sudo cp /srv/data/kanipi_foo/kanipi_foo.service /etc/systemd/system/
sudo systemctl enable --now kanipi_foo
```

Or run directly with docker:

```bash
docker run -d -i --name kanipi_foo \
    --network=host \
    -v /srv/data/kanipi_foo:/srv/app/home \
    -v /srv/run/kanipi_foo:/srv/run/kanipi_foo \
    -v /var/run/docker.sock:/var/run/docker.sock \
    kanipi foo
```

## Troubleshooting

```bash
# check service health
sudo systemctl status kanipi_<name>

# recent logs (expect: Database initialized, channels connected, Running)
sudo journalctl -u kanipi_<name> --since "5 min ago" --no-pager | head -30

# errors only
sudo journalctl -u kanipi_<name> --since "5 min ago" | grep -iE 'error|fatal'

# orphan containers (>1h old are suspect)
sudo docker ps --filter "name=nanoclaw-" --format "{{.Names}} {{.Status}}"
```

Common issues:

- **"no .env"**: run `./kanipi create <name>` first or check PREFIX
- **agent hangs**: check `CLAUDE_CODE_OAUTH_TOKEN` is set in `.env`
- **no media processing**: set `MEDIA_ENABLED=true` in `.env`
- **voice not transcribed**: set `VOICE_TRANSCRIPTION_ENABLED=true`,
  ensure whisper service is running

## Philosophy

Kanipi is infrastructure, not a product. The goal is a hard, tested,
boring core that you build on top of without surprises. Channel adapters,
skills, routing rules, and personas are yours to write, fork, and share.

Every boundary is a seam where you can cut in and replace a part without
touching the rest. This is the bazaar model — the core holds, everything
around it is yours. Agents running on kanipi are first-class participants:
they can read their own skills, propose modifications, and ship changes
through the same channels humans use.

If you build on kanipi — say so. Attribution is a social contract.

## Acknowledgements

Built on the shoulders of people doing serious work in this space.
If you use kanipi, acknowledge the chain.

| Project                                                  | Author        | License     | What it contributed                                                              |
| -------------------------------------------------------- | ------------- | ----------- | -------------------------------------------------------------------------------- |
| [nanoclaw](https://github.com/qwibitai/nanoclaw)         | qwibitai      | MIT         | Direct ancestor — container-per-session model, the original shape of this system |
| [ElizaOS](https://github.com/elizaOS/eliza)              | elizaOS       | MIT         | character.json agent persona model, plugin ecosystem thinking                    |
| [Claude Code](https://github.com/anthropics/claude-code) | Anthropic     | Proprietary | The agent runtime everything runs on — tools, subagents, MCP, skills             |
| [smolagents](https://github.com/huggingface/smolagents)  | Hugging Face  | Apache-2.0  | Code-as-action framing; thinking about what the minimal agent loop looks like    |
| [OpenClaw](https://github.com/openclaw/openclaw)         | openclaw      | MIT         | Multi-channel binding architecture, single-process gateway design                |
| [NemoClaw](https://github.com/NVIDIA/NemoClaw)           | NVIDIA        | Apache-2.0  | Landlock + seccomp + netns sandboxing model for agent containers                 |
| [Muaddib](https://github.com/pasky/muaddib)              | Petr Baudis   | MIT         | QEMU micro-VM isolation, 3-tier chronicle memory design                          |
| [Hermes](https://github.com/NousResearch/hermes-agent)   | Nous Research | MIT         | Self-improving skill learning across sessions                                    |
| [takopi](https://github.com/banteg/takopi)               | banteg        | MIT         | Telegram→agent dispatch, live progress streaming                                 |
| [arizuko](https://github.com/onvos/arizuko)              | onvos         | GPL v3      | Go rewrite of kanipi — orthogonal components, MCP IPC, production hardening      |

## License

[Unlicense](LICENSE) — public domain. Do whatever you want with it.

If you build on kanipi — say so. Not because you have to.
Because that's how good work compounds.

## Development

```bash
npm install                    # install deps
make build                     # tsc compile (src/ -> dist/)
make lint                      # typecheck without emitting
make test                      # vitest (src/ + tests/e2e/)
make agent-image               # build agent container
npm run dev                    # tsx dev mode
```

Makefile uses `bunx` internally. Pre-commit hooks: prettier
(single quotes), typecheck, hygiene.
