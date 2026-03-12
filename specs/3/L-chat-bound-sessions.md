# Chat-Bound Sessions

**Status**: spec

One container per (group, chatJid) pair. Containers exit immediately after
producing output. `send_reply` for the bound chat; `send_message` for
cross-chat. Parallel across chatJids within a group.

## Problem

### IDLE_TIMEOUT and stuck containers

Containers stay alive for 30 minutes (IDLE_TIMEOUT default) after their last
output, waiting for follow-up messages. In practice, most conversations are
single-turn or have long pauses between turns. The idle wait wastes resources.

Worse: if the SDK session becomes stale or the agent hangs mid-turn, the
container holds its chatJid slot open for the full IDLE_TIMEOUT. All messages
from that chatJid queue until the timeout fires. Recovery requires waiting 30+
minutes.

### Implicit reply path

Agents reply by calling `send_message(chatJid, text)` where `chatJid` is the
source JID injected by the gateway. The agent must receive it, track it, and
pass it back explicitly. The intent — "reply to whoever sent me this message"
— has no dedicated action. Tier restrictions enforce the right behavior but
don't name it.

### Cross-chatJid parallelism

`GroupQueue` already supports parallel chatJid containers (each chatJid has its
own `GroupState`). But IDLE_TIMEOUT means containers linger, consuming concurrency
slots and preventing new work. With IDLE_TIMEOUT = 0, each chatJid frees its
slot immediately after producing output, enabling true parallelism.

## Design

### One container per chatJid turn

Each container spawn is bound to one chatJid — its **source JID**. The container
exits immediately after producing output. No idle wait.

Key properties:

- **No lingering**: container exits after completing a turn. IDLE_TIMEOUT = 0.
- **No cross-chatJid interleaving**: messages from chatJid A never arrive in
  a container serving chatJid B.
- **Parallel across chatJids**: group `atlas/support` can serve `tg/12345` and
  `tg/67890` simultaneously, subject to MAX_CONCURRENT_CONTAINERS.
- **Strict per-chatJid ordering**: messages from the same chatJid queue behind
  each other.

Multi-message turns still work: if a second message from chatJid X arrives
while the container for X is running, it queues as `pendingMessages` and is
piped via `queue.sendMessage` (the existing IPC pipe path). The container
processes it in the same run. Only after the container exits does IDLE_TIMEOUT
= 0 take effect — meaning no new container run waits for the next turn.

### IDLE_TIMEOUT = 0

Default changes from 1800000 (30 min) to 0.

Effect in `processGroupMessages` (index.ts):

- The idle timer (`resetIdleTimer`) fires `queue.closeStdin(chatJid)` after
  IDLE_TIMEOUT ms. With IDLE_TIMEOUT = 0, call `closeStdin` immediately after
  the first output — i.e., replace the `setTimeout`-based timer with a direct
  call inside the `onOutput` callback.
- In practice: if IDLE_TIMEOUT === 0, skip the setTimeout entirely. Call
  `queue.closeStdin(chatJid)` directly after the first successful output chunk.
- The container runner timeout formula `Math.max(configTimeout, IDLE_TIMEOUT + 30_000)`
  becomes `Math.max(configTimeout, 30_000)` when IDLE_TIMEOUT = 0. No code
  change needed — the formula handles it.

Existing instances with IDLE_TIMEOUT set explicitly in `.env` are unaffected
until they update their config.

### `NANOCLAW_CHAT_JID` env var

Each container's MCP server subprocess already receives `NANOCLAW_CHAT_JID`
(set in `container/agent-runner/src/index.ts`). The MCP server (`ipc-mcp-stdio.ts`)
already reads it and injects it into every IPC request. This is already
implemented on the agent side.

The gateway side is incomplete:

- `ipc.ts`'s `drainRequests` does not yet extract `chatJid` from request data
- `ActionContext` does not yet have a `chatJid` field
- `buildContext()` does not yet populate it

Required addition in `src/container-runner.ts`: set `NANOCLAW_CHAT_JID` in
the container's top-level env (not just the MCP subprocess) via the existing
`updateSettings` call, so the main agent process can also read it:

```typescript
// In runAgentMode, in the updateSettings call:
NANOCLAW_CHAT_JID: input.chatJid,
```

### `send_reply` action

New action: `send_reply(text: string)`.

- No `chatJid` argument — uses `ctx.chatJid` (the bound source JID)
- Authorization: all tiers. Replying to the triggering conversation is always allowed
- Sends via `ctx.sendMessage(ctx.chatJid, text)`

```typescript
export const sendReply: Action = {
  name: 'send_reply',
  description:
    'Reply to the current conversation (bound chatJid). ' +
    'Use this instead of send_message when replying to whoever sent you a message.',
  input: z.object({ text: z.string() }),
  async handler(raw, ctx) {
    const { text } = z.object({ text: z.string() }).parse(raw);
    if (!ctx.chatJid) throw new Error('no bound chat JID');
    await ctx.sendMessage(ctx.chatJid, text);
    return { sent: true };
  },
};
```

Register in `ipc.ts` alongside `sendMessage` and `sendFile`.

### `send_message` distinction

`send_message(chatJid, text)` remains unchanged. It is for **cross-chat
messaging**: notifying another group, sending to a different channel,
escalation outputs, programmatic broadcasts.

Documentation update:

- "Use `send_reply` to respond to the current conversation."
- "Use `send_message` to send to a different chat or group."

Calling `send_message` with `chatJid == ctx.chatJid` is allowed and produces
the same result as `send_reply`. The distinction is semantic and for agent
clarity.

### `chatJid` on `ActionContext`

`ActionContext` gains a `chatJid` field:

```typescript
export interface ActionContext {
  sourceGroup: string;
  chatJid: string; // bound source JID for this container run; '' if unknown
  isRoot: boolean;
  tier: 0 | 1 | 2 | 3;
  // ... rest unchanged
}
```

`buildContext()` in `ipc.ts` accepts an additional `chatJid` parameter.
`drainRequests()` extracts it from the request JSON:

```typescript
const chatJid = typeof data.chatJid === 'string' ? data.chatJid : '';
const ctx = buildContext(sourceGroup, chatJid, deps);
```

Backward compatible: old agent-runners that don't send `chatJid` get an empty
string; `send_reply` throws "no bound chat JID" for them.

## Group-Queue Changes

### State model unchanged

`GroupQueue` maps `chatJid → GroupState`. Already the right granularity. No
structural change.

### `folderToActiveJid` → `folderToChatJids`

```typescript
private folderToChatJids = new Map<string, Set<string>>();
```

`registerProcess` adds the chatJid to the folder's set. `releaseGroup` removes
it. Multiple chatJids active per folder is now normal.

### Remove `preemptFolderIfNeeded`

This method preempts an idle container on folder X when a new chatJid Y needs
the same folder. With IDLE_TIMEOUT = 0, containers don't linger idle — they
exit immediately after output. No preemption needed. Remove from `group-queue.ts`
and its call site in `index.ts`.

### Task container chatJid

Task containers send to the group's default registered JID. Populate
`ctx.chatJid` with the group's primary JID for task containers so `send_reply`
works in scheduled tasks.

## Message Loop Changes (index.ts)

The message loop already routes per-chatJid via `queue.enqueueMessageCheck(chatJid)`.
No structural change needed.

Change in `processGroupMessages` for IDLE_TIMEOUT = 0:

- Skip the `setTimeout`-based idle timer entirely
- Call `queue.closeStdin(chatJid)` directly in the `onOutput` callback after
  the first output is received (or rely on natural container self-termination
  after the SDK `query()` loop completes — `closeStdin` is belt-and-suspenders)

## Session Continuity

### Recommendation: per-group session (Option A)

Session ID keyed by `group.folder` (current behavior). All chatJids for the
same group share one session transcript.

Rationale: parallel containers for the same group both resume the same SDK
session. Cross-user context is a feature for group-chat deployments.

Risk: concurrent SDK session writes. Two containers for the same group, both
appending to the same `.jl` file simultaneously, could corrupt the transcript.
Must be verified empirically on a live instance before enabling parallel
chatJid containers at scale.

### Fallback: per-(group, chatJid) session (Option B)

If concurrent session writes prove unsafe, key sessions by
`${group.folder}:${chatJid}`. The DB `sessions` table needs a `chat_jid`
column. Implement only if Option A fails validation.

### System messages and new-session injection

With parallel chatJids, two containers may both see an absent session and both
enqueue `new-session` system messages. This is benign — the second container
resumes the session started by the first. Possible duplicate diary injection;
harmless in practice.

## Connection to `local:` JID Escalation (3/5-permissions)

Chat-bound sessions make `local:` JID escalation natural:

```
user → worker  (chatJid = tg/12345)
  worker calls escalate_group(prompt)
    gateway spawns parent  (chatJid = local:atlas/support)
      parent runs send_reply(answer) → stored as message on local:atlas/support
        message loop routes local:atlas/support → atlas/support folder
          new worker container  (chatJid = local:atlas/support)
            worker calls send_message(tg/12345, text)  ← NOT send_reply
              user receives the final answer
```

Note: the worker's second container is bound to `local:atlas/support`, so its
`send_reply` would go back to itself. To reach the original user at `tg/12345`,
the worker must use `send_message(tg/12345, text)`. The original chatJid should
be threaded through the escalation prompt so the worker knows where to reply.
Document this in skills and 5-permissions.

## Open Questions

1. **Concurrent SDK session writes**: Are two simultaneous containers for the
   same group folder + session ID safe? The Claude Code SDK may lock the `.jl`
   file or handle concurrent appends gracefully. Must verify empirically.

2. **Escalation final reply**: The worker's second container (bound to
   `local:atlas/support`) needs `tg/12345` to reply to the user. Gateway must
   thread the original chatJid into the escalation message body or as a
   structured field. Spec the exact mechanism in 5-permissions.

3. **Config migration**: Operators relying on IDLE_TIMEOUT for persistent
   multi-turn containers should set `IDLE_TIMEOUT` explicitly in `.env`.
   Default change should be in CHANGELOG with clear callout.

## Implementation Order

1. **`chatJid` on `ActionContext`** — add field, update `buildContext()`,
   extract from IPC request data. Purely additive.

2. **`send_reply` action** — add to `src/actions/messaging.ts`, register in
   `ipc.ts`. Immediately usable after step 1.

3. **`NANOCLAW_CHAT_JID` in container settings** — add to `updateSettings`
   in `runAgentMode`. Makes it available to the main agent process.

4. **IDLE_TIMEOUT = 0 default** — change default in `config.ts`. Update
   `processGroupMessages` idle timer: skip setTimeout, call `closeStdin`
   directly after first output.

5. **Concurrent session verification** — deploy test instance with
   IDLE_TIMEOUT = 0, two parallel chatJid users on same group. Observe
   transcript integrity. Decide Option A vs B.

6. **Remove `preemptFolderIfNeeded`** — after IDLE_TIMEOUT = 0 is stable.

7. **`folderToActiveJid` → `folderToChatJids`** — minor refactor after
   behavior is validated.

8. **`local:` JID routing** — implement from 3/5-permissions after
   chat-bound sessions are stable. The two features compose cleanly.
