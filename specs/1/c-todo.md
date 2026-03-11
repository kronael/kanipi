# v1 specs — status

## Shipped

| Spec            | Version | Summary                                                    |
| --------------- | ------- | ---------------------------------------------------------- |
| actions         | v0.6.0  | Action registry, request-response IPC, tool manifest       |
| auth            | v0.5.0  | Local accounts (argon2id), JWT + refresh tokens            |
| channels        | v0.4.0  | Channel interface; telegram, whatsapp, discord, email, web |
| cli             | v0.4.0  | Bash entrypoint: create, run, group add/list/rm            |
| commands        | v0.4.0  | /new, /ping, /chatid via action registry                   |
| email           | v0.5.0  | IMAP IDLE + SMTP, email_threads table                      |
| extend-agent    | v0.5.0  | Agent MCP self-registration, settings.json merge           |
| extend-skills   | v0.4.0  | Skill seeding, /migrate, MIGRATION_VERSION                 |
| file-output     | v0.5.0  | send_file IPC action, sendDocument on channels             |
| group-routing   | v0.6.0  | Hierarchical routing, delegate_group, routing_rules        |
| whisper         | v0.6.0  | Whisper transcription service, HTTP client                 |
| ipc-signal      | v0.5.0  | SIGUSR1 wakeup, fs.watch gateway-side                      |
| memory-messages | v0.4.0  | Stdin XML envelope, 100 msg limit (MSG_LIMIT)              |
| memory-session  | v0.4.0  | Session recording, error notification, cursor rollback     |
| mime            | v0.5.0  | VoiceTranscriber, VideoAudioTranscriber, GenericFileSaver  |
| prompt-format   | v0.6.0  | Stdin JSON, XML history, pendingArgs order, JSON stdout    |
| slink           | v0.5.0  | POST /pub/s/<token>, rate limiting, JWT auth               |
| sync            | v0.4.0  | /migrate skill + MIGRATION_VERSION system                  |
| system-messages | v0.4.0  | Tables, enqueue/flush, new-session, new-day                |
| testing         | v0.6.0  | Unit + e2e + smoke tiers, testability seams                |
| worlds          | v0.4.0  | JID normalization, world boundaries, nested folders        |

## Reference specs (documentation, no code changes)

- **extend-gateway** — registry patterns, hardcoded vs declarative
- **channels** — channel interface contract (code predates spec)
- **prompt-format** — format documentation (code predates spec)
- **router** — routing flow documentation (code predates spec)
- **reference-systems** — brainpro, takopi, eliza-atlas analysis
- **testing** — test infrastructure and conventions

## Shipped (continued)

| Spec          | Version | Summary                                                       |
| ------------- | ------- | ------------------------------------------------------------- |
| memory-diary  | v0.7.0  | Agent daily notes, PreCompact nudge, gateway injection        |
| files         | v0.7.0  | `/file put`, `/file get`, `/file list` bidirectional transfer |
| introspection | v0.7.0  | .gateway-caps TOML manifest, .whisper-language config         |
| forward-meta  | v0.7.0  | Forward origin + reply-to context per channel                 |

## Open (not shipped)

- **OAuth providers** — docs exist, local auth ships, provider login does not.

## Moved to v1m2

- **plugins** — agent-proposed, operator-approved plugin flow → `3/E-plugins.md`

## Not in scope for v1

- **isolated MCP servers** — container-based MCP isolation deferred to phase 3

## Shipped (late additions)

| Spec         | Version | Summary                                              |
| ------------ | ------- | ---------------------------------------------------- |
| cli-ts       | v1.0.6  | TypeScript CLI rewrite (src/cli.ts)                  |
| db-bootstrap | v1.0.6  | Versioned migrations (src/migrations.ts, .sql files) |
| testcontain  | v1.0.6  | Integration tests with testcontainers, scenario mode |

## Deferred to v1m2

- `get_history` -> `3/C-message-mcp.md`
- Agent-side media -> `3/N-workflows.md`
- IPC -> MCP proxy -> `3/A-ipc-mcp-proxy.md`
- Systems -> `1/Z-systems.md` (#topics, @agents, workflows)
