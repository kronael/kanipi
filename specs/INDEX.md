# Specs Index

Phase state and spec inventory. See ROADMAP.md for milestones.

## Phase 1 — Core Gateway (shipped)

37 specs. All core subsystems operational.

| Spec                | Topic                     | Status             |
| ------------------- | ------------------------- | ------------------ |
| 0-actions           | Action registry, IPC      | shipped            |
| 1-agent-routing     | Pipeline routing (v2)     | open               |
| 2-agent-teams       | Multi-agent patterns      | decided (use SDK)  |
| 3-auth              | Local auth, JWT           | partial (no OAuth) |
| 4-channels          | Channel interface         | shipped            |
| 5-cli               | TypeScript CLI            | shipped            |
| 6-commands          | /new /ping /chatid /stop  | shipped            |
| 7-db-bootstrap      | Migration system          | shipped            |
| 8-email             | IMAP IDLE + SMTP          | shipped            |
| 9-extend-agent      | Skills, CLAUDE.md, MCP    | shipped            |
| A-extend-gateway    | Gateway registries        | reference          |
| B-extend-skills     | Skill system, /migrate    | shipped            |
| C-file-output       | send_file IPC             | shipped            |
| D-files-in          | File transfer             | partial            |
| E-forward-metadata  | Forward/reply metadata    | shipped            |
| F-group-routing     | Flat routing table        | done               |
| G-instance-repos    | Git-based config (v2)     | open               |
| H-introspection     | .gateway-caps manifest    | shipped            |
| J-ipc-signal        | SIGUSR1 wakeup            | shipped            |
| K-knowledge-system  | Memory layers pattern     | partial            |
| L-memory-diary      | Diary notes               | shipped            |
| M-memory-managed    | CLAUDE.md + MEMORY.md     | shipped            |
| N-memory-messages   | Message history piping    | shipped            |
| P-memory-session    | SDK sessions, .jl files   | partial            |
| Q-mime              | Media pipeline            | shipped            |
| R-prompt-format     | stdin JSON, XML history   | shipped            |
| S-reference-systems | Architecture analysis     | reference          |
| T-router            | Router flow, mount table  | shipped            |
| U-setup             | Marinade Atlas setup      | shipped            |
| V-sidecars          | MCP sidecars              | partial            |
| W-slink             | Web channel POST API      | shipped            |
| X-sync              | /migrate skill system     | shipped            |
| Y-system-messages   | New-session, new-day, etc | shipped            |
| Z-systems           | Decomposition overview    | reference          |
| a-task-scheduler    | Cron tasks                | shipped            |
| b-testing           | Test strategy             | reference          |
| c-todo              | Phase 1 status table      | reference          |
| d-voice             | Whisper transcription     | shipped            |
| e-worlds            | Nested folders, tiers     | partial            |

## Phase 2 — Permissions & Capabilities (in progress)

10 specs. Focus: access control, agent tools, testing gaps.

| Spec                    | Topic                       | Status     |
| ----------------------- | --------------------------- | ---------- |
| 0-agent-capabilities    | Container tooling catalog   | spec       |
| 1-atlas-capabilities    | Facts, researcher, verifier | partial    |
| 2-autotesting           | Subsystem test strategy     | spec       |
| 3-memory-facts          | Persistent knowledge (v2)   | open       |
| 4-paths                 | Path translation cleanup    | open       |
| 5-permissions           | Tier 0-3 hierarchy          | partial    |
| 7-user-context          | Per-user memory files       | open       |
| 8-web-virtual-hosts     | Per-group web serving       | spec draft |
| 9-whatsapp-improvements | Read receipts, presence     | open       |
| B-worlds-rooms          | Threading/room models       | research   |

## Phase 3 — Channels, Dashboards, Memory (planned)

16 specs. Focus: social channels, operator tools, memory layers.

| Spec                   | Topic                       | Status |
| ---------------------- | --------------------------- | ------ |
| 3-support              | Code researcher agent       | spec   |
| 4-dashboards           | Long-running web services   | open   |
| 7-facebook             | Facebook Page channel       | spec   |
| 8-gmail                | Gmail API channel           | spec   |
| B-memory-episodic      | Diary aggregation           | open   |
| G-reddit               | Reddit channel              | spec   |
| H-researcher           | Background research tasks   | open   |
| L-twitter              | Twitter/X channel           | spec   |
| P-dash-status          | Health dashboard            | open   |
| Q-dash-memory          | Memory viewer/editor        | open   |
| R-evangelist           | Community engagement        | open   |
| S-social-events        | Unified inbound model       | open   |
| T-social-actions       | Outbound action catalog     | open   |
| U-channel-actions      | Dynamic action registration | open   |
| V-platform-permissions | Per-platform grants         | spec   |

## Phase 4 — Agent Extensions & Workflows (future)

15 specs. Focus: agent-to-agent, self-modification, workflows.

| Spec                      | Topic                          | Status          |
| ------------------------- | ------------------------------ | --------------- |
| 0-agent-code-modification | Gateway staging area           | not started     |
| 1-agent-messaging         | Sloth links as inboxes         | spec            |
| 2-agent-pipeline          | Inter-agent workflows          | product config  |
| 6-extend-gateway-self     | Root agent modifies gateway    | open            |
| 9-identities              | Cross-channel identity         | open            |
| A-ipc-mcp-proxy           | Unix socket replaces file IPC  | spec            |
| C-message-mcp             | Agent-side history queries     | spec            |
| D-message-wal             | Write-ahead log delivery       | spec            |
| E-plugins                 | Agent-proposed plugins         | not implemented |
| F-prototypes              | Group spawn from routing       | open            |
| J-sse                     | Per-group SSE stream           | incomplete      |
| K-topicrouting            | @agent #topic routing          | open            |
| M-webdav                  | WebDAV workspace access        | spec            |
| N-workflows               | Media MCP, delegation          | spec            |
| P-codebase-trim           | Dead code removal (~900 lines) | spec            |

## Phase 5-7 — Products (deferred)

| Phase | Topic                 | Status                      |
| ----- | --------------------- | --------------------------- |
| 5     | Agent media awareness | open (convert to migration) |
| 6     | Evangelist            | superseded by 3/R           |
| 7     | Multi-agent commits   | moved to tools repo         |

## Resources

| File                     | Topic                                  |
| ------------------------ | -------------------------------------- |
| res/eliza-prompts        | ElizaOS prompt patterns                |
| res/ex-1                 | SDK stale session experiment (done)    |
| res/ex-2                 | Auto-compact session experiment (done) |
| res/social-platform-libs | Platform library recommendations       |
| res/xml-vs-json-llm      | LLM prompt format research             |
