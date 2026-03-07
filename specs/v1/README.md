# v1 Specs

37 specs. Status from [todo.md](todo.md): shipped, partial, open.

## Channels & Input

- [channels.md](channels.md) — channel interface, activation, JID prefixes (shipped)
- [email.md](email.md) — IMAP IDLE inbound + SMTP outbound (shipped)
- [voice.md](voice.md) — Whisper transcription for voice/audio messages (shipped)
- [slink.md](slink.md) — web channel via POST token endpoint, rate limiting (shipped)
- [forward-metadata.md](forward-metadata.md) — forward origin + reply-to context per channel (shipped)
- [mime.md](mime.md) — media attachment pipeline: download, transcribe, annotate (partial)
- [files.md](files.md) — bidirectional /put, /get, /ls file transfer (shipped)
- [file-output.md](file-output.md) — agent sends files back to channel via IPC (shipped)

## Routing & Groups

- [router.md](router.md) — JID resolution, group dispatch, prompt assembly (shipped, reference)
- [worlds.md](worlds.md) — nested JIDs, glob routing, chat metadata (shipped)
- [group-routing.md](group-routing.md) — hierarchical routing, delegate_group, routing_rules (shipped)
- [agent-routing.md](agent-routing.md) — specialized worker agents within a group (open, v2)

## Memory

- [memory-messages.md](memory-messages.md) — recent history via stdin XML envelope (shipped)
- [memory-session.md](memory-session.md) — SDK session continuity across container runs (shipped)
- [memory-managed.md](memory-managed.md) — CLAUDE.md + MEMORY.md built-in persistence (shipped)
- [memory-diary.md](memory-diary.md) — agent daily notes in diary/YYYYMMDD.md (shipped)

## IPC & Container

- [ipc-signal.md](ipc-signal.md) — SIGUSR1 wakeup replacing 500ms polling (shipped)
- [isolation.md](isolation.md) — MCP servers in own containers, socket transport (shipped)
- [mcp-sidecar.md](mcp-sidecar.md) — agent-driven MCP sidecar provisioning via IPC (open)

## Actions & Commands

- [actions.md](actions.md) — action registry, request-response IPC, tool manifest (shipped)
- [commands.md](commands.md) — /new, /ping, /chatid gateway-intercepted commands (shipped)
- [task-scheduler.md](task-scheduler.md) — cron-based scheduled tasks via IPC (shipped)

## Auth & Web

- [auth.md](auth.md) — local accounts, argon2id, JWT + refresh tokens (shipped)
- [auth-oauth.md](auth-oauth.md) — OAuth provider support for web UI (open)

## Agent & Extensibility

- [extend-agent.md](extend-agent.md) — agent MCP self-registration, settings.json merge (shipped)
- [extend-gateway.md](extend-gateway.md) — gateway registry patterns (reference)
- [extend-skills.md](extend-skills.md) — skill seeding, /migrate, MIGRATION_VERSION (shipped)
- [plugins.md](plugins.md) — agent-proposed, operator-approved plugin flow (open)
- [introspection.md](introspection.md) — .gateway-caps TOML manifest, .whisper-language config (shipped)

## Prompt & Format

- [prompt-format.md](prompt-format.md) — stdin JSON, XML history, JSON stdout (shipped, reference)
- [system-messages.md](system-messages.md) — gateway annotations: new-session, new-day (shipped)

## Infrastructure

- [cli.md](cli.md) — bash entrypoint: create, run, group add/list/rm (shipped, TS rewrite deferred)
- [db-bootstrap.md](db-bootstrap.md) — versioned DB migrations replacing inline ALTER TABLE (open)
- [sync.md](sync.md) — /migrate skill + MIGRATION_VERSION sync system (shipped)
- [testing.md](testing.md) — unit + e2e + smoke tiers, testability seams (shipped, reference)

## Reference

- [reference-systems.md](reference-systems.md) — brainpro, takopi, eliza-atlas analysis
- [todo.md](todo.md) — status tracker with version numbers for all specs
