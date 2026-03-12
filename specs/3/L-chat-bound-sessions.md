# Chat-Bound Sessions

**Status**: spec

One container per folder, strictly serial. Containers exit when the SDK query
completes. `send_reply` for the bound chat; `send_message` for cross-chat.

## Model

- **Container = folder**. One active container per folder at a time, always serial.
- **Multiple JIDs → same folder**: queued. A second JID's message waits until
  the current container exits.
- **Same JID → different folders**: parallel. JID1 can hit `root` and
  `atlas/support` simultaneously — those are different folder containers.
- **No per-JID containers**. JID is source context, folder is the processing unit.

This is exactly the current `GroupQueue` model. No structural change needed.

## Problem

Agents reply by calling `send_message(chatJid, text)` where `chatJid` is
injected by the gateway. The agent must track it explicitly. The intent —
"reply to whoever sent me this message" — has no dedicated action.

## Changes

### Container exits when done

Remove `IDLE_TIMEOUT` entirely — the config and the `setTimeout` idle timer
logic. Container runs one SDK `query()`, produces output, exits naturally.
No gateway signal needed.

### `NANOCLAW_CHAT_JID` in container settings

The MCP subprocess already receives `NANOCLAW_CHAT_JID`. Add it to the
top-level container env via `updateSettings` in `runAgentMode`:

```typescript
NANOCLAW_CHAT_JID: input.chatJid,
```

### `chatJid` on `ActionContext`

```typescript
export interface ActionContext {
  sourceGroup: string;
  chatJid: string; // bound source JID; '' if unknown
  // ... rest unchanged
}
```

`drainRequests()` extracts `chatJid` from request JSON (agent already sends it):

```typescript
const chatJid = typeof data.chatJid === 'string' ? data.chatJid : '';
```

Backward compatible: old agent-runners get `''`; `send_reply` throws for them.

### `send_reply` action

```typescript
export const sendReply: Action = {
  name: 'send_reply',
  description:
    'Reply to the current conversation. Use instead of send_message when replying to whoever sent you a message.',
  input: z.object({ text: z.string() }),
  async handler(raw, ctx) {
    const { text } = z.object({ text: z.string() }).parse(raw);
    if (!ctx.chatJid) throw new Error('no bound chat JID');
    await ctx.sendMessage(ctx.chatJid, text);
    return { sent: true };
  },
};
```

Register in `ipc.ts` alongside `sendMessage`.

### Task container chatJid

Tasks already store `chat_jid` at registration time. Pass `task.chat_jid`
as `chatJid` into `ActionContext` for task containers — `send_reply` then
works naturally. No guessing needed.

## Session Continuity

Session ID keyed by `group.folder` (unchanged). The container always resumes
the same SDK session for the folder. Containers are short-lived (exit after
each query) but session history is preserved across runs via the `.jl` file.

No concurrent session write risk — folder containers are serial.

## Connection to `local:` Escalation (3/5-permissions)

With chat-bound sessions, escalation is natural:

```
worker (chatJid=tg/12345) → escalate_group
  parent runs with chatJid=local:atlas/support
    parent replies → stored as message on local:atlas/support
      message loop → new worker container (chatJid=local:atlas/support)
        worker calls send_message(tg/12345, text)  ← NOT send_reply
```

Worker's second container is bound to `local:atlas/support`, so `send_reply`
would reply there (wrong). Worker must use `send_message(originalJid, text)`.
Original chatJid must be threaded into the escalation prompt body.

## Implementation Order

1. `chatJid` on `ActionContext` — additive, no risk
2. `send_reply` action — additive
3. `NANOCLAW_CHAT_JID` in container settings
4. Remove `IDLE_TIMEOUT` config and idle timer logic
5. `local:` JID routing — after 5-permissions is implemented
