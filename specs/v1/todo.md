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
| isolation       | v0.6.0  | MCP sidecar lifecycle, socket transport, per-group config  |
| ipc-signal      | v0.5.0  | SIGUSR1 wakeup, fs.watch gateway-side                      |
| memory-messages | v0.4.0  | Stdin XML envelope, 100 msg limit (MSG_LIMIT)              |
| memory-session  | v0.4.0  | Session recording, error notification, cursor rollback     |
| mime            | v0.5.0  | VoiceTranscriber, VideoAudioTranscriber, GenericFileSaver  |
| prompt-format   | v0.6.0  | Stdin JSON, XML history, pendingArgs order, JSON stdout    |
| slink           | v0.5.0  | POST /pub/s/<token>, rate limiting, JWT auth               |
| sync            | v0.4.0  | /migrate skill + MIGRATION_VERSION system                  |
| system-messages | v0.4.0  | Tables, enqueue/flush, new-session, new-day                |
| testing         | v0.6.0  | Unit + e2e + smoke tiers, testability seams                |
| worlds          | v0.4.0  | / separator, isRoot(), glob routing, chat metadata         |

## Reference specs (documentation, no code changes)

- **extend-gateway** — registry patterns, hardcoded vs declarative
- **channels** — channel interface contract (code predates spec)
- **prompt-format** — format documentation (code predates spec)
- **router** — routing flow documentation (code predates spec)
- **reference-systems** — brainpro, takopi, eliza-atlas analysis
- **testing** — test infrastructure and conventions

## Shipped (continued)

| Spec          | Version | Summary                                                |
| ------------- | ------- | ------------------------------------------------------ |
| memory-diary  | v0.7.0  | Agent daily notes, PreCompact nudge, gateway injection |
| files         | v0.7.0  | /put, /get, /ls bidirectional file transfer            |
| introspection | v0.7.0  | .gateway-caps TOML manifest, .whisper-language config  |
| forward-meta  | v0.7.0  | Forward origin + reply-to context per channel          |

## Open (not shipped)

- **db-bootstrap** — versioned migrations (src/migrations.ts
  - .sql files). Currently inline try/catch ALTER TABLE.
- **plugins** — agent-proposed, operator-approved plugin flow.
  Trust boundary designed. No code yet.

## Not in scope for v1

- **cli TS rewrite** — bash entrypoint works, no urgency
- **docker integration tests** — need testcontainers + CI
- **sidecar actions** — specced in mcp-sidecar.md + actions.md,
  container-runner has lifecycle code, action handlers not yet wired

## Deferred to v2

- `get_history` -> `v2/message-mcp.md`
- Agent-side media -> `v2/workflows.md`
- IPC -> MCP proxy -> `v2/ipc-mcp-proxy.md`
- Systems -> `v2/systems.md` (#topics, @agents, workflows)
