# v1 specs — status

## Shipped

| Spec            | Version | Summary                                                    |
| --------------- | ------- | ---------------------------------------------------------- |
| actions         | v0.5.0  | Action registry, request-response IPC, tool manifest       |
| auth            | v0.5.0  | Local accounts (argon2id), JWT + refresh tokens            |
| channels        | v0.4.0  | Channel interface; telegram, whatsapp, discord, email, web |
| cli             | v0.4.0  | Bash entrypoint: create, run, group add/list/rm            |
| commands        | v0.4.0  | /new, /ping, /chatid via action registry                   |
| email           | v0.5.0  | IMAP IDLE + SMTP, email_threads table                      |
| extend-agent    | v0.5.0  | Agent MCP self-registration, settings.json merge           |
| extend-skills   | v0.4.0  | Skill seeding, /migrate, MIGRATION_VERSION                 |
| file-output     | v0.5.0  | send_file IPC action, sendDocument on channels             |
| group-routing   | v0.6.0  | Hierarchical routing, delegate_group, routing_rules        |
| isolation       | v0.6.0  | MCP sidecar lifecycle, socket transport, per-group config  |
| ipc-signal      | v0.5.0  | SIGUSR1 wakeup, fs.watch gateway-side                      |
| memory-messages | v0.4.0  | Stdin XML envelope, 30 msg / 2 day limit                   |
| memory-session  | v0.4.0  | Session recording, error notification, cursor rollback     |
| mime            | v0.5.0  | VoiceTranscriber, VideoAudioTranscriber, GenericFileSaver  |
| prompt-format   | v0.4.0  | Stdin JSON, XML history, JSON stdout markers               |
| slink           | v0.5.0  | POST /pub/s/<token>, rate limiting, JWT auth               |
| sync            | v0.4.0  | /migrate skill + MIGRATION_VERSION system                  |
| system-messages | v0.4.0  | Tables, enqueue/flush, new-session, new-day                |
| worlds          | v0.4.0  | / separator, isRoot(), glob routing, chat metadata         |

## Reference specs (documentation, no code changes)

- **extend-gateway** — registry patterns, hardcoded vs declarative
- **channels** — channel interface contract (code predates spec)
- **prompt-format** — format documentation (code predates spec)
- **router** — routing flow documentation (code predates spec)
- **reference-systems** — brainpro, takopi, eliza-atlas analysis
- **critique** — open issues cross-review
- **testing** — test infrastructure and conventions

## Open (not shipped)

- **db-bootstrap** — versioned migrations (src/migrations.ts
  - .sql files). Currently inline try/catch ALTER TABLE.
- **files** — /file put, /file get gateway commands for
  bidirectional file transfer. No code yet.
- **memory-diary** — agent-written daily notes, PreCompact
  flush, session-end flush. No code yet.
- **plugins** — agent-proposed, operator-approved plugin flow.
  Trust boundary designed. No code yet.
- **introspection** — .gateway-caps manifest, agent-writable
  config files. Only .whisper-language partially exists.

## Not in scope for v1

- **cli TS rewrite** — bash entrypoint works, no urgency
- **docker integration tests** — need testcontainers + CI

## Deferred to v2

- `get_history` -> `v2/message-mcp.md`
- Agent-side media -> `v2/workflows.md`
- IPC -> MCP proxy -> `v2/ipc-mcp-proxy.md`
- Systems -> `v2/systems.md` (#topics, @agents, workflows)
