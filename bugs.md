# Bugs

Observed issues from log/conversation audit 2026-03-19/20. Review and fix.

---

## B1 — Telegram reply_parameters.message_id must be a Number [marinade, 12:05]

**Evidence:** `GrammyError: Call to 'sendMessage' failed! (400: Bad Request: field "message_id" must be a Number)`
**Context:** After HTML parse failure retried as plain text, the reply parameter failed.
**Root cause:** `opts.replyTo` not validated before `Number()` conversion. Non-numeric string → NaN. After the `lastSentId` chain-reply fix (3af6231), the triggering user message ID is always used — likely a valid numeric string now. Monitor.
**Fix:** `src/channels/telegram.ts:428` — guard: if `Number(opts.replyTo)` is NaN, omit `reply_parameters` entirely.

---

## B2 — Container killed with code 137 at startup [marinade]

**Evidence:** `Container exited with error: code 137` — agent-runner logged startup, then SIGKILL'd with no output in ~14s.
**Context:** Container spawned, initialized session, then immediately killed before producing any output. Session evicted.
**Root cause:** OOM or concurrent gateway restart. No distinction made between OOM kill (code 137, no output, short duration) and idle cleanup (code 137, had output).
**Fix:** `src/container-runner.ts:855-910` — detect OOM: code 137 + `hadStreamingOutput = false` + duration < 30s → log as OOM, not generic error. Log available memory at spawn.

---

## B3 — Vite PostCSS errors: missing reveal.js font file [marinade, 12:31]

**Evidence:** `[postcss] ENOENT: no such file or directory, open './fonts/source-sans-pro/source-sans-pro.css'`
**Context:** Virtual-validator presentation has a local `reveal/` directory missing font files. Vite tries to compile it via PostCSS and fails. Presentation uses CDN.
**Fix:** Remove `/srv/data/kanipi_marinade/web/atlas/virtual-validator/reveal/` (data, not code).

---

## B4 — WhatsApp route JID without domain suffix [rhias, pre-fix]

**Evidence:** Messages stored with `group_folder = ''` — route `whatsapp:420775035931` never matched `whatsapp:420775035931@s.whatsapp.net`.
**Status:** Fixed in DB (route updated to full JID). New routes via CLI may have same issue.
**Fix:** `src/actions/groups.ts:262` — normalize JID before calling `addRoute()`. Incoming WA messages always have `@s.whatsapp.net` suffix (set at `src/channels/whatsapp.ts:209`).

---

## B5 — User sees silence during long container runs [marinade]

**Evidence:** `"you never responded to me with anything."` — all while Atlas container was running for 6605s.
**Context:** Heartbeat (agent-runner/src/index.ts:314) keeps gateway alive every 30s but is `result: null` — no user-visible output. User sees nothing for 90+ min.
**Fix:** Agent should emit `<status>` IPC blocks periodically (e.g. every 5 min) during long tool-heavy tasks. Update agent CLAUDE.md/skills to prompt this behavior.

---

## B6 — Heartbeat stops typing indicator and signals idle [all channels] ⚠️

**Root cause confirmed:** `src/index.ts:545-582` — heartbeat arrives as `{ status: 'success', result: null }`. The onOutput callback:

1. `if (result.result)` → false, no message sent ✓
2. `if (result.status === 'success')` → **true** → calls `stopTypingFor(chatJid)` and `queue.notifyIdle()` ✗

This means every 30s heartbeat **stops the typing indicator** and marks the agent as idle. The typing indicator is not restarted until the next real output arrives (too late — it expired).
**Fix:** `src/index.ts:574` — differentiate heartbeat (null result) from completion. Only call `stopTypingFor`/`notifyIdle` when `result.result !== null` OR when container exits. On heartbeat, call `startTyping()` instead.

---

## B7 — No CLI tooling to replay missed messages [rhias]

**Context:** Route fix required manual DB rollback of `router_state` + `last_agent_timestamp`. No CLI command for this.
**Fix:** `src/cli.ts` — add `kanipi config <instance> route replay <jid> [--since <timestamp>]` command that resets per-JID agent timestamp to trigger reprocessing.

---

## B8 — WhatsApp `AwaitingInitialSync` timeout loop on every restart [rhias]

**Evidence:** Every connect: `awaiting notification with a 20s timeout.` then `Timeout in AwaitingInitialSync, forcing state to Online`
**Root cause:** `src/channels/whatsapp.ts:105-114` — `makeWASocket()` called without `syncTimeout` option. Baileys waits indefinitely for history sync notification that never arrives (degraded WA Web session).
**Fix:** Add `syncTimeout: 20000` to `makeWASocket()` options (already using the 20s behavior — just make explicit). Investigate whether incoming messages during the sync window are buffered — the `shouldReconnect: true` path flushes `outgoingQueue` but incoming message buffering is unclear.

---

## B9 — Vite stdout leaks into gateway journalctl [marinade] (found 2026-03-20)

**Evidence:** `7:37:47 AM [vite] (client) page reload atlas/virtual-validator/test-specs.html` appears in gateway systemd journal.
**Root cause:** `src/cli.ts:927` — Vite spawned with `stdio: 'inherit'`. All Vite HMR output (page reloads, build errors, PostCSS warnings) flows to gateway stdout → systemd journal → pollutes operational logs.
**Fix:** Change `stdio: 'inherit'` to `stdio: 'ignore'` (or pipe to a dedicated log file like `groups/<folder>/logs/vite.log`).

---

## B10 — WhatsApp 503 stream errors create ~22s message gap [rhias] (found 2026-03-20)

**Evidence:** 4 × `stream:error code 503` overnight (21:21, 00:37, 01:32, 01:50). Each triggers reconnect + B8 AwaitingInitialSync 20s delay.
**Root cause:** `src/channels/whatsapp.ts:129-196` — on `connection === 'close'`, calls `scheduleReconnect(1)` (2s delay). After reconnect, enters AwaitingInitialSync (20s). Total gap per event: ~22s where incoming messages are not received. No message replay after reconnect.
**Fix:** After `connection === 'open'` handler, request message history for the gap window. Or track last-received-message timestamp and use Baileys history sync to recover. Short-term: confirm `shouldReconnect: true` path doesn't drop buffered incoming messages.

---

## B11 — Orphan agent containers steal IPC messages after gateway restart [marinade, 2026-03-20]

**Evidence:** Three `nanoclaw-atlas-*` containers running simultaneously (22h and 24h old orphans + current). Message piped at 09:30 consumed by orphan; current container received SIGUSR1 but found empty input dir; user got no reply for 27 minutes.

**Root cause:** IPC has no per-container ownership — all containers mount the same `data/ipc/<group>/input/` directory and any can consume files. On gateway restart, previously spawned agent containers become orphans (still running, still polling IPC). Gateway has no record of them and spawns a new container. Both old and new compete for input files.

**Why orphans survive:** `systemd ExecStartPre` only stops/removes the gateway docker container, not agent containers. Agent containers are spawned with `--rm` but only exit on timeout or explicit kill. Gateway restart does not kill them.

**Fix:** On gateway startup, kill all containers matching `nanoclaw-*` prefix before accepting new work. Or: store the container name in the queue state and kill it on restart. `src/index.ts` startup or `src/group-queue.ts` init.
