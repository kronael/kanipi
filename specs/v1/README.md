# v1 Architecture

37 specs. Status from [todo.md](todo.md): shipped, partial, open.

## Architecture

```
                    ┌─────────────┐
                    │   Channels  │  telegram, whatsapp, discord, email, web
                    └──────┬──────┘
                           │ messages
                    ┌──────▼──────┐
                    │   Router    │  JID resolution, group dispatch
                    └──────┬──────┘
                           │ routing rules
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐    │     ┌──────▼──────┐
       │  Commands   │    │     │   Groups    │  worlds, routing, delegation
       │  (user→gw)  │    │     └──────┬──────┘
       └─────────────┘    │            │
                   ┌──────▼──────┐     │
                   │Prompt Format│     │  XML history, system messages
                   └──────┬──────┘     │
                          │ stdin      │
                   ┌──────▼──────┐     │
                   │  Container  │◄────┘  docker, mounts, isolation
                   └──────┬──────┘
                          │ IPC (SIGUSR1 + files)
              ┌───────────┼───────────┐
              │           │           │
       ┌──────▼──────┐   │    ┌──────▼──────┐
       │   Actions   │   │    │   Memory    │  diary, session, messages
       │  (agent→gw) │   │    └─────────────┘
       └──────┬──────┘   │
              │           │
    ┌─────────┼─────┐    │
    │         │     │    │
 ┌──▼───┐ ┌──▼──┐  │  ┌─▼──────────┐
 │Tasks │ │Files│  │  │Extensibility│  skills, MCP, plugins
 └──────┘ └─────┘  │  └────────────┘
                   │
            ┌──────▼──────┐
            │    Auth     │  JWT, refresh, accounts
            └─────────────┘
```

Specs are organized by concern, top-down from user input to
agent execution. Each layer depends on layers above it.

## Channels & Input

Inbound message handling. Each channel implements the same
interface; specs describe channel-specific behavior.

- [channels.md](channels.md) — channel interface, activation, JID prefixes (shipped)
- [email.md](email.md) — IMAP IDLE inbound + SMTP outbound (shipped)
- [voice.md](voice.md) — Whisper transcription for voice/audio (shipped)
- [slink.md](slink.md) — web channel via POST token endpoint (shipped)
- [forward-metadata.md](forward-metadata.md) — forward origin + reply-to context (shipped)
- [mime.md](mime.md) — media pipeline: download, transcribe, annotate (partial)
- [files.md](files.md) — inbound /put, /get, /ls user file transfer (shipped)
- [file-output.md](file-output.md) — outbound agent sends files via IPC (shipped)

## Routing & Groups

Message dispatch. Router resolves JID → group, routing rules
control delegation between groups.

- [router.md](router.md) — JID resolution, group dispatch, prompt assembly (shipped)
- [worlds.md](worlds.md) — nested JIDs, glob routing, chat metadata (shipped)
- [group-routing.md](group-routing.md) — hierarchical routing, delegation, rules (shipped)
- [agent-routing.md](agent-routing.md) — worker agents within a group (open, v2)

## Prompt & Format

What the container receives. Router builds the prompt;
these specs define its structure.

- [prompt-format.md](prompt-format.md) — stdin JSON, XML history, JSON stdout (shipped)
- [system-messages.md](system-messages.md) — gateway annotations: new-session, new-day (shipped)

## IPC & Container

Agent execution environment. Container lifecycle, IPC protocol,
MCP sidecar isolation.

- [ipc-signal.md](ipc-signal.md) — SIGUSR1 wakeup replacing 500ms polling (shipped)
- [isolation.md](isolation.md) — MCP servers in own containers, socket transport (shipped)
- [mcp-sidecar.md](mcp-sidecar.md) — agent-driven sidecar provisioning (open)

## Actions & Commands

Two directions of control. Commands: user → gateway.
Actions: agent → gateway via IPC.

- [actions.md](actions.md) — action registry, request-response IPC, tool manifest (shipped)
- [commands.md](commands.md) — /new, /ping, /chatid gateway-intercepted (shipped)
- [task-scheduler.md](task-scheduler.md) — cron-based scheduled tasks via IPC (shipped)

## Memory

Four memory layers, each with different persistence and scope.

- [memory-messages.md](memory-messages.md) — recent history via stdin XML (shipped)
- [memory-session.md](memory-session.md) — SDK session continuity across runs (shipped)
- [memory-managed.md](memory-managed.md) — CLAUDE.md + MEMORY.md persistence (shipped)
- [memory-diary.md](memory-diary.md) — agent daily notes in diary/ (shipped)

## Agent & Extensibility

How agents extend themselves. Skills, MCP registration,
gateway capability discovery.

- [extend-agent.md](extend-agent.md) — MCP self-registration, settings.json (shipped)
- [extend-gateway.md](extend-gateway.md) — gateway registry patterns (reference)
- [extend-skills.md](extend-skills.md) — skill seeding, /migrate, versions (shipped)
- [plugins.md](plugins.md) — agent-proposed, operator-approved plugins (open)
- [introspection.md](introspection.md) — .gateway-caps TOML, .whisper-language (shipped)

## Auth & Web

Authentication for web channel. Not needed for telegram/discord/whatsapp.

- [auth.md](auth.md) — local accounts, argon2id, JWT + refresh (shipped)
- [auth-oauth.md](auth-oauth.md) — OAuth provider support (open)

## Infrastructure

Build, test, deploy, migrate.

- [cli.md](cli.md) — bash entrypoint: create, run, group (shipped)
- [db-bootstrap.md](db-bootstrap.md) — versioned DB migrations (open)
- [sync.md](sync.md) — /migrate skill + MIGRATION_VERSION (shipped)
- [testing.md](testing.md) — unit + e2e + smoke tiers (shipped)

## Reference

- [reference-systems.md](reference-systems.md) — brainpro, takopi, eliza-atlas analysis
- [todo.md](todo.md) — status tracker for all specs
