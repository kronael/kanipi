# v1 Architecture

37 specs. Status from [c-todo.md](c-todo.md): shipped, partial, open.

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

- [4-channels.md](4-channels.md) — channel interface, activation, JID prefixes (shipped)
- [8-email.md](8-email.md) — IMAP IDLE inbound + SMTP outbound (shipped)
- [d-voice.md](d-voice.md) — Whisper transcription for voice/audio (shipped)
- [W-slink.md](W-slink.md) — web channel via POST token endpoint (shipped)
- [E-forward-metadata.md](E-forward-metadata.md) — forward origin + reply-to context (shipped)
- [Q-mime.md](Q-mime.md) — media pipeline: download, transcribe, annotate (partial)
- [D-files-in.md](D-files-in.md) — inbound /put, /get, /ls user file transfer (shipped)
- [C-file-output.md](C-file-output.md) — outbound agent sends files via IPC (shipped)

## Routing & Groups

Message dispatch. Router resolves JID → group, routing rules
control delegation between groups.

- [T-router.md](T-router.md) — JID resolution, group dispatch, prompt assembly (shipped)
- [e-worlds.md](e-worlds.md) — nested JIDs, glob routing, chat metadata (shipped)
- [F-group-routing.md](F-group-routing.md) — hierarchical routing, delegation, rules (shipped)
- [1-agent-routing.md](1-agent-routing.md) — worker agents within a group (open, v2)

## Prompt & Format

What the container receives. Router builds the prompt;
these specs define its structure.

- [R-prompt-format.md](R-prompt-format.md) — stdin JSON, XML history, JSON stdout (shipped)
- [Y-system-messages.md](Y-system-messages.md) — gateway annotations: new-session, new-day (shipped)

## IPC & Container

Agent execution environment. Container lifecycle, IPC protocol,
MCP sidecar isolation.

- [J-ipc-signal.md](J-ipc-signal.md) — SIGUSR1 wakeup replacing 500ms polling (shipped)
- [V-sidecars.md](V-sidecars.md) — MCP servers in isolated containers: gateway-managed + agent-requested (partial)

## Actions & Commands

Two directions of control. Commands: user → gateway.
Actions: agent → gateway via IPC.

- [0-actions.md](0-actions.md) — action registry, request-response IPC, tool manifest (shipped)
- [6-commands.md](6-commands.md) — /new, /ping, /chatid gateway-intercepted (shipped)
- [a-task-scheduler.md](a-task-scheduler.md) — cron-based scheduled tasks via IPC (shipped)

## Memory

Four memory layers, each with different persistence and scope.

- [N-memory-messages.md](N-memory-messages.md) — recent history via stdin XML (shipped)
- [P-memory-session.md](P-memory-session.md) — SDK session continuity across runs (shipped)
- [M-memory-managed.md](M-memory-managed.md) — CLAUDE.md + MEMORY.md persistence (shipped)
- [L-memory-diary.md](L-memory-diary.md) — agent daily notes in diary/ (shipped)

## Agent & Extensibility

How agents extend themselves. Skills, MCP registration,
gateway capability discovery.

- [9-extend-agent.md](9-extend-agent.md) — MCP self-registration, settings.json (shipped)
- [A-extend-gateway.md](A-extend-gateway.md) — gateway registry patterns (reference)
- [B-extend-skills.md](B-extend-skills.md) — skill seeding, /migrate, versions (shipped)
- [../3/E-plugins.md](../3/E-plugins.md) — agent-proposed, operator-approved plugins (open)
- [H-introspection.md](H-introspection.md) — .gateway-caps TOML, .whisper-language (shipped)

## Auth & Web

Authentication for web channel. Not needed for telegram/discord/whatsapp.

- [3-auth.md](3-auth.md) — local accounts (shipped) + OAuth providers (open)

## Infrastructure

Build, test, deploy, migrate.

- [5-cli.md](5-cli.md) — bash entrypoint: create, run, group (shipped)
- [7-db-bootstrap.md](7-db-bootstrap.md) — versioned DB migrations (open)
- [X-sync.md](X-sync.md) — /migrate skill + MIGRATION_VERSION (shipped)
- [b-testing.md](b-testing.md) — unit + e2e + smoke tiers (shipped)

## Reference

- [S-reference-systems.md](S-reference-systems.md) — brainpro, takopi, eliza-atlas analysis
- [c-todo.md](c-todo.md) — status tracker for all specs
