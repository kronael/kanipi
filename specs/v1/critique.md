# v1 Spec Critique

Cross-referenced against refs/takopi, refs/muaddib, refs/brainpro.
Updated 2026-03-06.

Focus: extensibility and reusability. Speed/performance concerns
are out of scope — optimize only when measured.

---

## Resolved

- **spec/code mismatch on message injection** — code now conditionally
  injects `<messages>` only on new session (`index.ts:212`). Matches spec.
- **Unbounded message history** — spec says 30 messages, 2 days limit
  (memory-messages.md). Implemented.
- **Message duplication on resume** — `<messages>` only on new session.
- **`new-day` event no trigger** — implemented (`index.ts:234-245`).
- **`:` separator** — worlds spec uses `/`. Channels guarantee
  separator-free IDs.
- **`jid-hierarchy.md` missing** — merged into worlds.md.
- **Command handler loader** — `registerCommand()` exists. Actions spec
  supersedes further loader concerns.
- **`xml-vs-json-llm.md` reference** — file exists at
  `specs/xml-vs-json-llm.md`. Reference in commands.md is valid.
- **systems.md too skeletal** — removed. Superseded by
  `extend-gateway.md` flat registries approach.
- **Skill naming enforcement** — `^[a-z0-9\-]+$` validation in
  container-runner.ts + extend-skills.md.
- **Migration failure behavior** — already works: MIGRATION_VERSION
  updated per migration, retries from last on next run.
- **Queue depth unbounded** — system messages flush every spawn,
  no realistic accumulation scenario. Deferred.
- **`in_reply_to` truncation** — threading not implemented yet.
  Rule in channels.md, lands in prompt-format.md when threading ships.

---

## Still open

### memory-session.md

**Idle timeout + IPC interaction (MEDIUM)**
Does an inbound IPC message reset the idle timer? If yes, idle timeout
never fires during active tasks. If no, container killed mid-IPC.
Needs a rule.

**Auto-compact + DB messages boundary (MEDIUM)**
When SDK compacts, gateway doesn't know. Next spawn: DB messages are
full history, SDK context is compacted. Potential duplication at
boundary.

### system-messages.md

**Session crash recovery (LOW)**
If gateway crashes, `ended_at` may be null. Document fallback: null
`ended_at` = session ended abnormally.

### channels.md / worlds.md

**Thread vs reply orthogonality (MEDIUM)**
Threading (message concern) is orthogonal to JID hierarchy (routing).
Spec should clarify: `replyTo` is per-message, topic/thread ID is a
JID segment. The "leaf rule" holds but needs explicit note.

### commands.md

**`/help` implementation (MEDIUM)**
Listed as open. Needs: list commands with description, per-channel
format awareness.

### Cross-spec

**Session locking (MEDIUM)**
One agent per group enforced by `GroupQueue` but not documented as
the concurrency contract.

**Memory layer precedence (LOW)**
Multiple context sources arrive in same turn. Document order:
system messages → session history → diary → messages → user text.
