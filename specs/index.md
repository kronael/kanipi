# Specs Index

Phase state and spec inventory. See ROADMAP.md for milestones.

## Phase 1 — Core Gateway (shipped)

31 specs. All core subsystems operational.

| Spec                | Topic                     | Status    |
| ------------------- | ------------------------- | --------- |
| 0-actions           | Action registry, IPC      | shipped   |
| 4-channels          | Channel interface         | shipped   |
| 5-cli               | TypeScript CLI            | shipped   |
| 6-commands          | /new /ping /chatid /stop  | shipped   |
| 7-db-bootstrap      | Migration system          | shipped   |
| 8-email             | IMAP IDLE + SMTP          | shipped   |
| 9-extend-agent      | Skills, CLAUDE.md, MCP    | shipped   |
| A-extend-gateway    | Gateway registries        | reference |
| B-extend-skills     | Skill system, /migrate    | shipped   |
| C-file-output       | send_file IPC             | shipped   |
| E-forward-metadata  | Forward/reply metadata    | shipped   |
| F-group-routing     | Flat routing table        | shipped   |
| H-introspection     | .gateway-caps manifest    | shipped   |
| J-ipc-signal        | SIGUSR1 wakeup            | shipped   |
| L-memory-diary      | Diary notes               | shipped   |
| M-memory-managed    | CLAUDE.md + MEMORY.md     | shipped   |
| N-memory-messages   | Message history piping    | shipped   |
| Q-mime              | Media pipeline            | shipped   |
| R-prompt-format     | stdin JSON, XML history   | shipped   |
| S-reference-systems | Architecture analysis     | reference |
| T-router            | Router flow, mount table  | shipped   |
| U-setup             | Marinade Atlas setup      | shipped   |
| W-slink             | Web channel POST API      | shipped   |
| X-sync              | /migrate skill system     | shipped   |
| Y-system-messages   | New-session, new-day, etc | shipped   |
| Z-systems           | Decomposition overview    | reference |
| a-task-scheduler    | Cron tasks                | shipped   |
| b-testing           | Test strategy             | reference |
| c-todo              | Phase 1 status table      | reference |
| d-voice             | Whisper transcription     | shipped   |
| e-worlds            | Nested folders, tiers     | shipped   |

## Phase 2 — Social Channels (shipped)

6 specs. Five platforms + action infrastructure.

| Spec              | Topic                       | Status  |
| ----------------- | --------------------------- | ------- |
| f-facebook        | Facebook Page channel       | shipped |
| g-reddit          | Reddit channel              | shipped |
| h-twitter         | Twitter/X channel           | shipped |
| i-social-events   | Unified inbound model       | shipped |
| j-social-actions  | Outbound action catalog     | shipped |
| k-channel-actions | Dynamic action registration | shipped |

## Phase 3 — Permissions, Cleanup, Gaps (in progress)

Focus: access control, partial implementations, cleanup, and selected phase 4 items pulled forward.

| Spec                           | Topic                                             | Status     |
| ------------------------------ | ------------------------------------------------- | ---------- |
| 0-agent-capabilities           | Container tooling catalog                         | spec       |
| 1-atlas                        | Facts, researcher, verifier                       | shipped    |
| 2-autotesting                  | Subsystem test strategy                           | spec       |
| 4-paths                        | Path translation cleanup                          | shipped    |
| 5-permissions                  | Tier 0-3 hierarchy                                | partial    |
| 7-user-context                 | Per-user memory files                             | shipped    |
| 8-web-virtual-hosts            | Per-group web serving                             | spec draft |
| 9-whatsapp-improvements        | Read receipts, presence                           | shipped    |
| A-auth                         | Local auth, JWT                                   | shipped    |
| C-files-in                     | File transfer                                     | shipped    |
| D-knowledge-system             | Memory layers pattern                             | partial    |
| E-memory-session               | SDK sessions, .jl files                           | shipped    |
| G-codebase-trim                | Dead code removal (~900 lines)                    | spec       |
| H-jid-format                   | Compact JID URIs, sender IDs                      | shipped    |
| J-container-commands           | Generic container commands                        | shipped    |
| K-remove-triggers              | Remove trigger pattern system                     | shipped    |
| L-chat-bound-sessions          | Chat-bound containers, send_reply, IDLE_TIMEOUT=0 | shipped    |
| M-think-blocks                 | <think> delimiter for silent decisions            | shipped    |
| N-status-messages              | Agent-initiated status updates                    | shipped    |
| _(4/B)_ B-memory-episodic      | Diary → weekly/monthly episodes                   | open       |
| _(4/H)_ H-researcher           | Background research subagent                      | open       |
| _(4/P)_ P-dash-status          | Health dashboard (read-only)                      | open       |
| _(4/V)_ V-platform-permissions | Per-platform action grants                        | spec       |
| _(4/3)_ 3-support              | Code researcher product config                    | spec       |
| _(4/4)_ 4-dashboards           | Long-running web services                         | open       |

## Phase 4 — Arizuko (deferred)

Requires new instance or major architectural changes.

| Spec                  | Topic                             | Status                                          |
| --------------------- | --------------------------------- | ----------------------------------------------- |
| 1-agent-routing       | Pipeline routing to workers       | dropped — superseded by nested groups + routing |
| 8-gmail               | Gmail API channel                 | arizuko                                         |
| G-instance-repos      | Git-based config repos            | arizuko                                         |
| Q-dash-memory         | Memory viewer/editor              | arizuko                                         |
| R-evangelist          | Community engagement agent        | arizuko                                         |
| W-detached-containers | File-based container IPC, reclaim | arizuko (spec)                                  |

## Phase 5 — Agent Extensions & Workflows (future)

14 specs. Focus: agent-to-agent, self-modification, workflows.

| Spec                      | Topic                              | Status            |
| ------------------------- | ---------------------------------- | ----------------- |
| 0-agent-code-modification | Gateway staging area               | not started       |
| 2-agent-pipeline          | Inter-agent workflows              | product config    |
| 3-agent-teams             | Multi-agent patterns               | decided (use SDK) |
| 6-extend-gateway-self     | Root agent modifies gateway        | open              |
| 9-identities              | Cross-channel identity (needs 3/H) | open              |
| A-ipc-mcp-proxy           | Unix socket replaces file IPC      | spec              |
| C-message-mcp             | Agent-side history queries         | spec              |
| D-message-wal             | Write-ahead log delivery           | spec              |
| E-plugins                 | Agent-proposed plugins             | not implemented   |
| F-prototypes              | Group spawn from routing           | open              |
| J-sse                     | Per-group SSE stream               | incomplete        |
| K-topicrouting            | @agent #topic routing              | open              |
| M-webdav                  | WebDAV workspace access            | spec              |
| N-workflows               | Media MCP, delegation              | spec              |

## Phase 6+ — Products (deferred)

| Spec                    | Topic                 | Status                      |
| ----------------------- | --------------------- | --------------------------- |
| 0-agent-media-awareness | Agent media awareness | open (convert to migration) |
| 0-evangelist            | Evangelist            | superseded by 4/R           |

## Resources

| File                     | Topic                                  |
| ------------------------ | -------------------------------------- |
| res/eliza-prompts        | ElizaOS prompt patterns                |
| res/ex-1                 | SDK stale session experiment (done)    |
| res/ex-2                 | Auto-compact session experiment (done) |
| res/social-platform-libs | Platform library recommendations       |
| res/xml-vs-json-llm      | LLM prompt format research             |
