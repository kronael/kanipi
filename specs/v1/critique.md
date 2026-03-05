# v1 Spec Critique

Cross-referenced against refs/takopi, refs/muaddib, refs/brainpro.

---

## memory-messages.md

**CRITICAL: spec/code mismatch on message injection**
Spec says inject `<messages>` on new session only. Actual code (`index.ts:249`)
always injects regardless of session state. Muaddib also always injects — the
"new session only" rule may be wrong. Decide: update spec to match code, or
add the conditional guard.

**Unbounded message history (HIGH)**
`getMessagesSince()` has no count or time limit. Muaddib defaults to 5 messages;
brainpro truncates to 20k chars. After months of messages, every spawn replays
thousands of rows. Add a limit (`specs/v1/memory-messages.md` open).

**Message duplication on resume (MEDIUM)**
On session resume, DB messages covering the same period as the SDK transcript
are re-sent. No deduplication. Muaddib deduplicates by `(pid, role)`. Low risk
now but will cause confusion in production.

---

## memory-session.md

**Idle timeout + IPC interaction undefined (MEDIUM)**
Spec describes how IPC messages kept the rhias container alive for 4 days.
Does an inbound IPC message reset the idle timer? If yes, idle timeout never
fires during active tasks. If no, container gets killed mid-IPC. Needs a rule.

**Auto-compact + DB messages undefined (MEDIUM)**
When SDK compacts, gateway doesn't know it happened. Next spawn: DB messages
are full history, SDK context is compacted. Potential duplication at compaction
boundary. Refs don't use SDK compaction — they use explicit diary/chronicle.

**`previous_session` count is a guess (LOW)**
Spec says last 10 sessions. No rationale. Brainpro injects today + yesterday's
notes (2 entries). Could be configurable. Not blocking.

---

## system-messages.md

**`new-day` event has no trigger in code (MEDIUM)**
Spec documents `gateway:new-day` but no code path emits it. Either implement
or remove from spec.

**Queue depth unbounded (LOW)**
No max queue depth. Rapid enqueue + agent crash = unbounded DB growth. Add
a soft cap (e.g. 100 per group, drop oldest).

**Session history reconstruction on crash (LOW)**
If gateway crashes while writing to `sessions` table, `ended_at` may be null.
Next session sees incomplete `<previous_session>` records. Acceptable for v1 —
just document the fallback (null `ended_at` = session ended abnormally).

---

## channels.md / jid-hierarchy.md

**Glob performance risk (HIGH)**
Spec says "use minimatch" for JID matching. Minimatch runs per message on every
inbound event. Pre-compile and cache patterns at group registration time.

**`:` separator has no escape strategy (MEDIUM)**
If a channel ID ever contains `:`, JID parsing breaks. Muaddib uses `%2F`
encoding. For now document that kanipi segments (discord server IDs, telegram
chat IDs) are guaranteed to not contain `:` — or add escaping.

**Thread vs reply conflation (MEDIUM)**
Spec says "same JID leaf = reply, different JID = reference." But Telegram
forum topics: `tg:chatid:topicid` is a partition (JID segment), and replies
within that topic use `replyTo` (message-level). Threading is a message
concern; JID hierarchy is a routing concern. The "leaf rule" holds but the
spec should clarify these are orthogonal.

**`in_reply_to` XML truncation in prompt-format.md (LOW)**
channels.md says "120 chars" but prompt-format.md doesn't document it or
where XML escaping applies. Add a note.

---

## commands.md

**No handler loader/discovery mechanism (HIGH)**
Spec defines `CommandHandler` interface but never says how handlers are
discovered at startup. Brainpro scans `src/commands/*.md` files (YAML
frontmatter, markdown body). Consider adopting that pattern — simpler than
interface-based registration, testable without runtime.

**No `/help` implementation logic (MEDIUM)**
Listed as open but no spec. Does it filter by channel? Per-group or global?
Format? At minimum: list available commands with description, one per line.

**`xml-vs-json-llm.md` citation doesn't exist (LOW)**
Spec references this file but it's not in `specs/`. Either create it or
remove the reference.

---

## skills.md

**No naming enforcement (MEDIUM)**
Brainpro validates skill names as `^[a-z0-9\-]+$`. Kanipi doesn't. Without
validation, collision or path traversal risk. Add check at seeding time.

**Migration safety vague (MEDIUM)**
How is `MIGRATION_VERSION` tracked per group vs globally? What if a migration
fails midway — can it retry? Spec says "runs migrations" but doesn't define
failure behavior. Should be: stop and log; retry on next `/migrate`.

**Skills not connected to systems.md (LOW)**
Skills are seeded to `~/.claude/skills/` and the SDK loads them. But systems.md
doesn't reference skills as a context injection source. Clarify the link.

---

## systems.md

**Too skeletal to ship against (HIGH)**
No concrete TypeScript interfaces, no hook composition rules, no call site in
container-runner.ts shown. Muaddib has `ToolSet`, `MuaddibTool` with
`persistType`, hook call order. Systems.md needs concrete interface shapes
before implementation can start.

**Hook composition rules undefined (MEDIUM)**
If multiple contextHooks fire, are outputs concatenated? Can one veto others?
What if a hook throws? Define: outputs concatenated with `\n`, null = skip,
exceptions = log + skip + continue.

**Tool metadata absent (MEDIUM)**
No schema for MCP tools (name, description, inputSchema, persistType).
Muaddib's `persistType: "none" | "summary"` controls whether tool results
are cached for future context — important for cost. Add this to the tool
interface.

---

## Cross-spec

**No session locking / concurrency model (MEDIUM)**
Can two containers run for the same group simultaneously? No spec. Muaddib
and Takopi both enforce one-agent-per-room. Gateway's `GroupQueue` serializes
per group — but this isn't documented as the concurrency contract.

**Multiple memory layers have no precedence order (LOW)**
MEMORY.md, diary, session history, DB messages, system messages — all arrive
in the same turn. What wins if they conflict? Brainpro defines explicit load
order. Kanipi should document: system messages → session history → diary →
messages (→ user text).

---

## Not worth acting on

- `previous_session` count of 10 — fine for v1, tune later
- Queue atomicity race (gateway crash mid-flush) — extremely unlikely, fallback polling covers it
- PID 1 assumption in IPC-signal — already true by container design
- IPC signal coalescing — fallback polling handles it
