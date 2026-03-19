# Bugs

Observed issues from log/conversation audit 2026-03-19. Review and fix.

---

## B1 — Telegram reply_parameters.message_id must be a Number [marinade, 12:05]

**Evidence:** `GrammyError: Call to 'sendMessage' failed! (400: Bad Request: field "message_id" must be a Number)`
**Context:** After HTML parse failure retried as plain text, the reply parameter failed.
**Root cause:** Possibly `opts.replyTo` was a non-numeric string. After the `lastSentId` chain-reply fix (3af6231), the triggering user message ID is always used — this is a valid numeric string for Telegram. May be self-healed. Monitor.
**Fix:** Add guard: `Number(opts.replyTo)` is `NaN` → omit `reply_parameters` entirely rather than sending NaN.
**File:** `src/channels/telegram.ts`

---

## B2 — Container killed with code 137 at startup (atlas/tom, 11:45) [marinade]

**Evidence:** `Container exited with error: code 137 — [agent-runner] Received input for group: atlas/tom — Starting query (session: new, resumeAt: latest)...`
**Context:** Container spawned, logged startup, then immediately SIGKILL'd before producing any output. Session evicted as corrupted.
**Root cause:** Unknown — OOM, or killed by a concurrent gateway restart. The session was evicted so user would need to retry.
**Fix:** Log available memory at container spawn. Alert if containers are killed before producing output (not just idle cleanup). Distinguish OOM (code 137 with no output) from idle cleanup (code 137 after output).
**File:** `src/container-runner.ts`

---

## B3 — Vite PostCSS errors: missing reveal.js font file [marinade, 12:31]

**Evidence:** `[postcss] ENOENT: no such file or directory, open './fonts/source-sans-pro/source-sans-pro.css'`
**Context:** Virtual-validator presentation has a local `reveal/` directory from a temporary CDN-bypass experiment. The directory is incomplete (missing font files). Vite tries to compile it via PostCSS and fails.
**Fix:** Remove the incomplete `reveal/` directory from `/srv/data/kanipi_marinade/web/atlas/virtual-validator/`. Presentation uses CDN.
**File:** `/srv/data/kanipi_marinade/web/atlas/virtual-validator/reveal/` (data, not code)

---

## B4 — WhatsApp route JID without domain suffix [rhias, pre-fix]

**Evidence:** Messages stored with `group_folder = ''` — route `whatsapp:420775035931` never matched `whatsapp:420775035931@s.whatsapp.net`.
**Status:** Fixed in DB (route updated to full JID). But new routes created via CLI may have same issue.
**Fix:** Normalize JID at route creation time — strip or add `@s.whatsapp.net` consistently. Check `group route add` CLI command.
**File:** `src/cli.ts` (route add), `src/channels/whatsapp.ts` (JID normalization)

---

## B5 — "you never responded" — user confusion during long 110-min container runs [marinade]

**Evidence:** Messages: `"you never responded to me with anything."`, `"are you not responding like every?"`, `"wgat?"`, `"what?"` — all while Atlas container was running for 6605s.
**Context:** Container was running (no timeout), but user got no feedback for ~90 min. The 30s heartbeat (fdbac9f) prevents _gateway_ timeout but the user still sees silence.
**Fix:** Consider sending a user-visible `<status>` message at intervals (e.g. every 5 min) when the container is actively running but producing no output. Already possible via `<status>` IPC type — the agent would need to emit these.
**File:** Agent CLAUDE.md / container/agent-runner pattern

---

## B6 — No typing indicator during heartbeats [all channels]

**Related to B5.** The heartbeat emits a null result to reset gateway idle timer, but `stopTypingFor` is only called on `status: 'success'`. During long runs, typing indicator may expire (Telegram auto-expires after ~5s) and never restart.
**Fix:** In the heartbeat path, call `startTyping` again to refresh the indicator.
**File:** `src/index.ts` (onOutput callback), `container/agent-runner/src/index.ts`

---

## B7 — `last_agent_timestamp` not updated when route fix requires timestamp rollback [rhias]

**Context:** When a route bug caused messages to be unrouted, fixing the route required manually rolling back `router_state.last_timestamp` and `last_agent_timestamp`. If this happens again (e.g. new group added with wrong JID format), there's no tooling to replay missed messages.
**Fix:** Add a `kanipi replay-messages --jid <jid> --since <timestamp>` CLI command that sets the per-JID agent timestamp back and triggers reprocessing.
**File:** `src/cli.ts`
