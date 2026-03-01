# kanipi v2 architecture

Nanoclaw fork. Telegram-first gateway, systemd-managed,
MCP sidecar extensibility.

## Components

### Host orchestrator

Routes messages between channels and agent containers.
Manages state, scheduling, security.

| File                    | LOC | Role                           |
| ----------------------- | --- | ------------------------------ |
| src/index.ts            | 510 | main entry, lifecycle          |
| src/db.ts               | 670 | SQLite message store, polling  |
| src/container-runner.ts | 300 | Docker container lifecycle     |
| src/group-queue.ts      | 250 | per-group serial queue         |
| src/ipc.ts              | 200 | container ↔ host communication |
| src/task-scheduler.ts   | 200 | scheduled tasks                |
| src/mount-security.ts   | 420 | mount allowlist enforcement    |
| src/config.ts           | 78  | .env reader                    |
| src/router.ts           | 46  | message routing                |
| src/types.ts            | 105 | shared types                   |

### Agent container

Runs Claude SDK inside Docker. Entrypoint is
`container/agent-runner/`.

| File                 | LOC | Role                             |
| -------------------- | --- | -------------------------------- |
| src/index.ts         | 588 | Claude SDK client, tool dispatch |
| src/ipc-mcp-stdio.ts | 285 | MCP over stdio for IPC           |

MCP tools exposed to agent:

- `send_message` — reply to channel
- `schedule_task` — create scheduled task
- `register_group` — join/create group

### Channels

Each channel implements the Channel interface from types.ts.
All channels accept a shared `ChannelOpts` for construction:

```typescript
interface ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}
```

| File                     | LOC | JID prefix |
| ------------------------ | --- | ---------- |
| src/channels/telegram.ts | 245 | `tg:`      |
| src/channels/whatsapp.ts | 379 | `wa:`      |
| src/channels/discord.ts  | 190 | `discord:` |

Channels are compiled in, toggled at runtime by .env.
See [channels.md](channels.md) for strategy.

## Data layout

Per-instance directory: `/srv/data/kanipi_<name>/`

```
.env              config (read by readEnvFile(), not process.env)
groups/
  <group_id>/
    logs/         conversation logs
store/            persistent state (SQLite, WA auth)
data/
  ipc/            container ↔ host unix sockets
```

## Message flow

```
channel
  → db.insertMessage()
  → poll loop (2s interval)
  → trigger check (new messages since last cursor)
  → GroupQueue.enqueue()
  → container-runner.spawn()
  → agent processes, calls MCP tools
  → send_message tool → stdout
  → host routes to channel.sendMessage()
```

Two-cursor dedup: separate read/process cursors prevent
duplicate processing on restart.

## Security

- **Container isolation** — each agent runs in Docker with
  restricted mounts
- **Mount allowlist** — mount-security.ts enforces which
  paths containers can access
- **Secrets via stdin** — API keys passed through stdin,
  never mounted or env-injected
- **IPC authorization** — unix socket per container,
  validated by container ID

## Concurrency

- **GroupQueue** — serializes processing per group, prevents
  interleaved responses
- **Max 5 containers** — global container limit
- **Idle timeout** — containers killed after 30min idle

## Config

All config read from `.env` via `readEnvFile()`. Never
reads `process.env` directly.

Key variables:

| Variable           | Purpose                  |
| ------------------ | ------------------------ |
| ASSISTANT_NAME     | instance display name    |
| TELEGRAM_BOT_TOKEN | enables telegram channel |
| DISCORD_BOT_TOKEN  | enables discord channel  |
| TELEGRAM_ONLY      | legacy, removed in v2    |
| CONTAINER_IMAGE    | agent Docker image       |
| CONTAINER_TIMEOUT  | max container runtime    |
| ANTHROPIC_API_KEY  | Claude API key           |

## Skills

Skills are shell scripts in the agent container at
`.claude/skills/`.

| Skill         | Purpose                                | Keep?     |
| ------------- | -------------------------------------- | --------- |
| reload        | kill -TERM 1 to restart, config reload | yes       |
| info          | instance status                        | yes       |
| ship          | uvx ship CLI                           | if needed |
| agent-browser | playwright in container                | yes       |

## IPC

v1 uses file-based IPC with polling (500ms agent, 1000ms gateway).
v2 options:

- **Unix sockets** — bidirectional, no polling, no temp files.
  Gateway opens a socket per container, agent connects on start.
  Eliminates file I/O and directory scanning entirely.
- **Signal + file** — gateway writes file, sends SIGUSR1 to
  container. Agent wakes immediately. Gateway uses fs.watch()
  (inotify) for agent→gateway. Simpler migration from v1.
- **SQLite** — shared SQLite DB as IPC queue. Both sides poll
  or use WAL notifications. Leverages existing SQLite infra.

Current v2: signal + file (see specs/v1/ipc-signal.md).
v2 target: unix sockets for new containers, signal fallback
for backwards compat.

## Web serving

Vite dev server runs alongside the gateway in the bash
entrypoint. Agents mount /web and write apps directly.
v2 planned: dedicated vite container for isolation.

## v2 changes from v1

- `store/` for SQLite + WA auth state
- `TELEGRAM_ONLY` removed, channels toggled by token presence
- Discord channel added
- Web serving via vite (ported from takopipi)
- IPC: signal-triggered reads replacing pure polling
- Planned: unix socket IPC, dedicated vite container
- Planned: welcome message on first contact

## Welcome message (planned)

When a new user or group first contacts the bot, send a
greeting with a link to the howto page. Implementation:

- Gateway tracks `seen_jids` in SQLite (or check if group
  has any prior messages in DB)
- On first message from unknown JID: send welcome before
  processing the message through the agent
- Welcome text: "Hi! I'm {ASSISTANT_NAME}. Send me a
  message and I'll help. {WEB_HOST}/howto/ for setup guide."
- Config: `WELCOME_MESSAGE` in .env (optional override)
- Only fires once per JID, never repeats
