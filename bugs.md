# Bugs

Observed issues from log/conversation audit 2026-03-19/20. All resolved.

---

## B1 — Telegram reply_parameters.message_id must be a Number [marinade, 12:05]

**Status:** Fixed — `src/channels/telegram.ts` guards `Number(opts.replyTo)` with `!isNaN()`, omits `reply_parameters` if not numeric.

---

## B2 — Container killed with code 137 at startup [marinade]

**Status:** Closed — diagnostic-only improvement, not worth the complexity. OOM kills are rare and visible in journalctl.

---

## B3 — Vite PostCSS errors: missing reveal.js font file [marinade, 12:31]

**Status:** Closed — stale data dir on marinade server, not a code bug. Remove manually if it resurfaces.

---

## B4 — WhatsApp route JID without domain suffix [rhias]

**Status:** Fixed — `src/actions/groups.ts` normalizes `whatsapp:` JIDs to include `@s.whatsapp.net` before calling `addRoute()`.

---

## B5 — User sees silence during long container runs [marinade]

**Status:** Closed — `<status>` instructions already in CLAUDE.md; B6 heartbeat fix keeps typing indicator alive. No further action needed.

---

## B6 — Heartbeat stops typing indicator and signals idle [all channels]

**Status:** Fixed — `src/index.ts` now calls `startTyping()` on heartbeat (null result) instead of `stopTypingFor()` + `notifyIdle()`.

---

## B7 — No CLI tooling to replay missed messages [rhias]

**Status:** Closed — B4 fix prevents recurrence. One-time manual DB fix was sufficient.

---

## B8 — WhatsApp AwaitingInitialSync timeout loop on every restart [rhias]

**Status:** Fixed — `src/channels/whatsapp.ts` adds `shouldSyncHistoryMessage: () => false` to `makeWASocket()`, skipping history sync entirely on connect.

---

## B9 — Vite stdout leaks into gateway journalctl [marinade]

**Status:** Closed — journalctl is the right place for all service output.

---

## B10 — WhatsApp 503 stream errors create ~22s message gap [rhias]

**Status:** Resolved by B8 — gap was the AwaitingInitialSync wait, not message loss. WA server holds and replays messages on reconnect.

---

## B11 — Orphan agent containers steal IPC messages after gateway restart [marinade]

**Status:** Largely resolved by self-exit fix (935438f) — containers now exit when input/ is empty, eliminating long-lived orphans. Remaining race window is negligible.
