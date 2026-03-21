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

## Phase 2 — Social Channels (dropped → arizuko)

6 specs. Implemented then removed — see `specs/5/K-social-rollback.md`.
Social channels continue in arizuko.

| Spec              | Topic                       | Status          |
| ----------------- | --------------------------- | --------------- |
| f-facebook        | Facebook Page channel       | dropped→arizuko |
| g-reddit          | Reddit channel              | dropped→arizuko |
| h-twitter         | Twitter/X channel           | dropped→arizuko |
| i-social-events   | Unified inbound model       | dropped→arizuko |
| j-social-actions  | Outbound action catalog     | dropped→arizuko |
| k-channel-actions | Dynamic action registration | dropped→arizuko |

## Phase 3 — Permissions, Cleanup, Gaps (in progress)

Focus: access control, partial implementations, cleanup, and selected phase 4 items pulled forward.

| Spec                    | Topic                                                                | Status  |
| ----------------------- | -------------------------------------------------------------------- | ------- |
| 0-agent-capabilities    | Container tooling catalog                                            | shipped |
| 1-atlas                 | Facts, researcher, verifier                                          | shipped |
| 2-autotesting           | Subsystem test strategy                                              | shipped |
| 3-code-research         | Code research agent (merged H-researcher + 3-support)                | shipped |
| 4-paths                 | Path translation cleanup                                             | shipped |
| 5-permissions           | Tier 0-3 hierarchy                                                   | shipped |
| 7-user-context          | Per-user memory files                                                | shipped |
| 8-web-virtual-hosts     | Per-group web serving                                                | shipped |
| 9-whatsapp-improvements | Read receipts, presence                                              | shipped |
| A-auth                  | Local auth, JWT                                                      | shipped |
| C-files-in              | File transfer                                                        | shipped |
| D-knowledge-system      | Memory layers pattern                                                | shipped |
| E-memory-session        | SDK sessions, .jl files                                              | shipped |
| G-codebase-trim         | Dead code removal (~900 lines)                                       | shipped |
| H-jid-format            | Compact JID URIs, sender IDs                                         | shipped |
| J-container-commands    | Generic container commands                                           | shipped |
| K-remove-triggers       | Remove trigger pattern system                                        | shipped |
| L-chat-bound-sessions   | Chat-bound containers, send_reply, IDLE_TIMEOUT=0                    | shipped |
| M-think-blocks          | <think> delimiter for silent decisions                               | shipped |
| N-status-messages       | Agent-initiated status updates                                       | shipped |
| P-message-ids           | Reply/forward metadata per channel                                   | shipped |
| Q-auto-threading        | Template routing (per-user groups)                                   | shipped |
| R-reply-routing         | Per-sender batching, chunk chaining, reply threading                 | shipped |
| T-recall                | Knowledge retrieval (LLM grep → hybrid search)                       | shipped |
| B-memory-episodic       | Progressive compression (episodes + diary)                           | shipped |
| 4-dashboards            | Dashboard portal system (tile-based, registration)                   | shipped |
| P-dash-status           | Dashboard: status & health (expanded, errors)                        | shipped |
| S-dash-tasks            | Dashboard: scheduled tasks & run history                             | shipped |
| Q-dash-memory           | Dashboard: memory & knowledge browser (read-only)                    | shipped |
| T-dash-activity         | Dashboard: messages & activity flow                                  | shipped |
| U-dash-groups           | Dashboard: groups, routing, world structure                          | shipped |
| V-action-grants         | Token-based action permissions, delegation scoping                   | shipped |
| SYSTEM.md               | Custom system prompt override (agent-runner)                         | shipped |
| Z-audit-log             | Outbound message recording in messages table                         | shipped |
| S-topic-routing         | @agent/#topic prefix routes, named sessions, new `prefix` route type | shipped |

## Phase 4 — Active specs

| Spec                  | Topic                              | Status   |
| --------------------- | ---------------------------------- | -------- |
| K-versioning-personas | Composable personas via templates  | spec     |
| R-evangelist          | Community engagement agent         | →arizuko |
| W-detached-containers | File-based container IPC, reclaim  | →arizuko |
| X-onboarding          | Unrouted JID → approve → world     | shipped  |
| Y-control-chat        | Gateway ↔ operator command channel | shipped  |

## Phase 5 — End state

| Spec              | Topic                                | Status |
| ----------------- | ------------------------------------ | ------ |
| K-social-rollback | Remove social channels, declare done | next   |

## Resources

| File                     | Topic                                  |
| ------------------------ | -------------------------------------- |
| res/eliza-prompts        | ElizaOS prompt patterns                |
| res/ex-1                 | SDK stale session experiment (done)    |
| res/ex-2                 | Auto-compact session experiment (done) |
| res/social-platform-libs | Platform library recommendations       |
| res/xml-vs-json-llm      | LLM prompt format research             |
