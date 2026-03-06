# v1 Spec Critique

Cross-referenced against refs/takopi, refs/muaddib,
refs/brainpro. Updated 2026-03-06.

Focus: extensibility and reusability.

---

## Resolved

- spec/code mismatch on message injection — fixed
- Unbounded message history — 30 msgs, 2 days limit
- Message duplication on resume — `<messages>` new only
- `new-day` event — implemented
- `:` separator — worlds spec uses `/`
- `jid-hierarchy.md` — merged into worlds.md
- Command handler loader — actions spec supersedes
- `xml-vs-json-llm.md` reference — valid
- systems.md skeletal — removed, superseded by
  extend-gateway.md
- Skill naming enforcement — validated
- Migration failure behavior — works as designed
- Queue depth — flushes every spawn, deferred
- `in_reply_to` truncation — lands when threading ships

---

## Still open

### memory-session.md

**Idle timeout + IPC (MEDIUM)**: Does inbound IPC reset
idle timer? If yes, timeout never fires during tasks.
If no, container killed mid-IPC.

**Auto-compact + DB messages boundary (MEDIUM)**: When SDK
compacts, gateway doesn't know. Potential duplication at
boundary on next spawn.

### system-messages.md

**Session crash recovery (LOW)**: If gateway crashes,
`ended_at` may be null. Document fallback.

### channels.md / worlds.md

**Thread vs reply orthogonality (MEDIUM)**: `replyTo` is
per-message, topic/thread ID is a JID segment. Needs
explicit note.

### commands.md

**`/help` implementation (MEDIUM)**: Listed as open.

### Cross-spec

**Session locking (MEDIUM)**: One agent per group enforced
by `GroupQueue` but not documented as concurrency contract.

**Memory layer precedence (LOW)**: Document order:
system messages -> session history -> diary -> messages ->
user text.
