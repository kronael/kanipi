# kanipi v3 — Go rewrite

Replace the TypeScript gateway with a single Go binary.
The agent container (Claude SDK) stays TypeScript.

## Motivation

- Single static binary, no node_modules
- ~10x lower memory (Go binary vs Node.js runtime)
- Native concurrency (goroutines vs polling loops)
- Simpler deployment: copy binary + agent image

## Boundary

### Stays TypeScript

- `container/agent-runner/` — Claude SDK, MCP tools
- stdin JSON protocol (prompt, sessionId, secrets)
- stdout markers (`---NANOCLAW_OUTPUT_START---`)
- IPC file protocol (JSON files, `_close` sentinel)

### Rewritten in Go

Everything else: channels, DB, queue, container runner,
config, scheduler, security, entrypoint.

## Go module layout

```
cmd/kanipi/main.go          entrypoint (create + run)
internal/
  config/config.go           .env reader
  db/db.go                   SQLite (same schema as v2)
  queue/queue.go             per-group goroutine + semaphore
  container/
    runner.go                docker exec, stdin/stdout
    ipc.go                   file-based IPC (fsnotify)
  channel/
    channel.go               Channel interface
    telegram.go              gotgbot or telebot
    whatsapp.go              whatsmeow
    discord.go               discordgo
  router/router.go           JID → channel, message format
  scheduler/scheduler.go     cron tasks
  security/mounts.go         mount allowlist
```

## Channel interface

```go
type Channel interface {
    Name() string
    Connect(ctx context.Context) error
    SendMessage(jid, text string) error
    OwnsJID(jid string) bool
    SetTyping(jid string, on bool) error
    Disconnect() error
}
```

## Libraries

| Concern | Library | Notes |
|---------|---------|-------|
| sqlite | modernc.org/sqlite | pure Go, no CGO |
| telegram | gotgbot/v2 | long-polling |
| whatsapp | go.mau.fi/whatsmeow | signal protocol |
| discord | bwmarrin/discordgo | websocket gateway |
| file watch | fsnotify | replaces 500ms polling |
| cron | robfig/cron/v3 | task scheduling |
| env | joho/godotenv | .env parsing |
| logging | log/slog | stdlib structured logging |

## Container protocol

Unchanged from v2. Go spawns docker via `os/exec`:

```go
cmd := exec.CommandContext(ctx,
    "docker", "run", "-i", "--rm",
    "--name", name,
    "-e", "TZ="+tz,
    "-v", groupDir+":/workspace/group",
    "-v", ipcDir+":/workspace/ipc",
    // ... more mounts
    image,
)
cmd.Stdin = stdinPipe  // JSON with secrets
cmd.Stdout = parser    // marker-delimited output
```

Stdin JSON (same as v2):
```json
{
  "prompt": "...",
  "sessionId": "...",
  "groupFolder": "main",
  "chatJid": "tg:123",
  "isMain": true,
  "secrets": {"ANTHROPIC_API_KEY": "..."}
}
```

## Concurrency model

v2 uses polling loops + in-memory state maps.
v3 uses goroutines:

- **GroupQueue**: goroutine per active group, `chan Work`
  for incoming messages/tasks. Exits after idle timeout.
- **Container semaphore**: `chan struct{}` with capacity
  MAX_CONCURRENT_CONTAINERS.
- **Message loop**: single goroutine, reads DB for new
  messages, dispatches to group goroutines.
- **Channel listeners**: one goroutine per channel,
  blocked on library event loops.

## IPC

Same file protocol. Replace 500ms polling with fsnotify:

```go
watcher, _ := fsnotify.NewWatcher()
watcher.Add(inputDir)
for event := range watcher.Events {
    if event.Op&fsnotify.Create != 0 {
        processFile(event.Name)
    }
}
```

## SQLite schema

Identical to v2. Same tables: chats, messages,
scheduled_tasks, task_run_logs, router_state, sessions,
registered_groups. Existing v2 databases work without
migration.

## Config

Same `.env` format. Same keys:

```
ASSISTANT_NAME=Andy
TELEGRAM_BOT_TOKEN=123:ABC
DISCORD_BOT_TOKEN=MTIz...
CONTAINER_IMAGE=kanipi-agent:latest
MAX_CONCURRENT_CONTAINERS=5
IDLE_TIMEOUT=1800000
```

WhatsApp: enabled when `state/auth/creds.json` exists.

## Build

```makefile
build:
	go build -o kanipi cmd/kanipi/main.go

image:
	docker build -t kanipi .
```

Dockerfile:
```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -o /kanipi cmd/kanipi/main.go

FROM alpine:3.20
RUN apk add --no-cache docker-cli
COPY --from=build /kanipi /usr/local/bin/kanipi
COPY container/ /srv/app/container/
COPY template/ /srv/app/template/
ENTRYPOINT ["kanipi"]
```

## Migration from v2

1. Same SQLite schema — drop-in replacement
2. Same .env — no config changes
3. Same IPC protocol — existing agent containers work
4. Same data dir layout (`/srv/data/kanipi_<name>/`)
5. Same systemd unit (replace node with Go binary)

## Estimated scope

~2000-2500 LOC Go replacing ~3000 LOC TypeScript.
Go is more verbose in some areas (error handling) but
eliminates polling loops, callback nesting, and the
entire Node.js dependency tree.
