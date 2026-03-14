---
status: draft
---

# R: Per-sender reply routing

## Problem

The bot's reply doesn't thread to the triggering user's message.
Two related issues compound to break the natural chat flow.

### 1. Delegation path loses replyTo

The direct path (`processGroupMessages` → `runAgent`) passes
`replyTo: lastMsg.id` (index.ts:460):

```typescript
await channel.sendMessage(chatJid, text, { replyTo: lastMsg.id });
```

But the delegation path (`delegateToGroup`) drops it (index.ts:616):

```typescript
if (text) await channel.sendMessage(originJid, text);
// ← no replyTo
```

When `{sender}` routing delegates Alice's message to `atlas/tg-98765`,
the response appears as a standalone message in the chat — not
threaded to Alice's message.

### 2. Batch processing conflates senders

Messages are grouped by `chatJid` (the chat), not by sender. If
Alice and Bob both send messages in the same poll cycle, they're
batched together. `lastMsg.id` is whoever sent last, so the reply
threads to the wrong person.

## Design

### A. sendMessage returns sent message ID

Change `Channel.sendMessage` return type from `Promise<void>` to
`Promise<string | undefined>`. All platform APIs already return
the sent message ID — currently discarded.

```typescript
// types.ts
interface Channel {
  sendMessage(
    jid: string,
    text: string,
    opts?: SendOpts,
  ): Promise<string | undefined>;
}
```

| Channel  | API return                          | ID field           |
| -------- | ----------------------------------- | ------------------ |
| Telegram | `bot.api.sendMessage()` → `Message` | `.message_id`      |
| Discord  | `ch.send()` → `Message`             | `.id`              |
| WhatsApp | `sock.sendMessage()` → `WAProto`    | `.key.id`          |
| Local    | self-generated                      | return `id` string |

### B. Chunk chaining — each reply threads to previous

When the agent sends multiple messages (streaming chunks or IPC
`send_reply`), each response threads to the **previous sent message**,
not all to the original. This creates a natural conversation chain:

```
Alice: "help me with X"         ← original message
  └─ Bot: "Sure, here's..."     ← replyTo: Alice's msg (returned id = 801)
       └─ Bot: "Also..."        ← replyTo: 801 (returned id = 802)
            └─ Bot: "Done."     ← replyTo: 802
```

Implementation: the streaming callback and IPC send path maintain a
`lastSentId` variable. First message uses `replyTo: messageId`
(the triggering message). Each subsequent message uses the returned
ID from the previous send.

```typescript
// in delegateToGroup streaming callback
let lastSentId = messageId; // start with triggering message
async (result) => {
  if (text) {
    const sentId = await channel.sendMessage(
      originJid,
      text,
      lastSentId ? { replyTo: lastSentId } : undefined,
    );
    if (sentId) lastSentId = sentId;
  }
};
```

Same pattern in `processGroupMessages` streaming callback and in
the `send_reply` / `send_message` IPC action handlers.

### C. Pass messageId through delegation

`delegateToChild`, `delegateToParent`, and `delegateToGroup` gain
an optional `messageId` parameter. The streaming callback uses it
as the initial `replyTo`.

```typescript
function delegateToChild(
  childFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
  messageId?: string,
): Promise<void> {
  return delegateToGroup(
    childFolder,
    prompt,
    originJid,
    depth,
    'delegate',
    messageId,
  );
}
```

`messageId` also flows into `ContainerInput` so the agent sees it
in `start.json` — already has the field, just never populated in
the delegation path.

### D. IPC send_reply auto-injects replyTo

When the agent uses `send_reply` or `send_message` (targeting the
bound chatJid), the gateway auto-injects `replyTo` from the
current chain position if the agent doesn't explicitly provide one.
This is the same path as stdout — the return path is unified.

The IPC deps track `lastSentId` per chatJid, shared with the
streaming callback. When `send_reply` fires, it uses `lastSentId`
as `replyTo` and updates it with the returned ID.

### E. Per-sender batching — always

Messages from the same chatJid are split by sender before
processing. Each sender's messages become a separate unit with
their own `messageId` for reply threading.

```
messages for telegram:12345 = [Alice:"help", Bob:"hi", Alice:"thanks"]
→ split by sender:
  Alice: ["help", "thanks"] → replyTo = Alice's last msg id
  Bob:   ["hi"]             → replyTo = Bob's msg id
```

This applies to ALL routes, not just `{sender}` templates:

- **Static routes** (all users → same group): each sender's batch
  is a separate `processGroupMessages` / delegation call. The
  group still sees only one sender's messages at a time, but
  replies thread correctly to each user.
- **Template routes** (`{sender}`): each sender naturally routes
  to their own group folder. Per-sender batching ensures correct
  `messageId` per delegation.

Cursor tracking stays per-chatJid — advance to cover all messages
in the poll cycle regardless of sender. The per-sender split
happens at dispatch time, not cursor time.

### F. Escalation reply threading

Escalation is LLM-to-LLM: the parent's response goes to
`local:worker`, not directly to the user. The worker then
forwards to the user. Threading matters on the final hop.

**Current escalation flow (traced):**

```
1. Worker processes telegram:12345 (messageId="567")
2. Worker calls escalate_group(prompt, chatJid="telegram:12345")
3. escalate_group wraps in <escalation reply_to="telegram:12345"
   reply_id="567">
4. delegateToParent("atlas", xml, "local:atlas/tg-98765", depth)
5. Parent container: chatJid="local:atlas/tg-98765", no messageId
6. Parent responds → LocalChannel stores in local:atlas/tg-98765
7. Message loop: chatJid="local:atlas/tg-98765" → folder=atlas/tg-98765
8. Worker processes parent's response
   - chatJid is now "local:atlas/tg-98765" (NOT telegram:12345)
   - send_reply would target local channel, not user
   - Worker must use send_message(chatJid="telegram:12345") explicitly
```

**Problem**: at step 8, the worker's current `chatJid` is the
local channel. `send_reply` goes to the wrong place. The worker
must remember the original user JID and messageId from its earlier
invocation (preserved in session transcript) and explicitly
`send_message` to the user.

This works but is fragile — it depends on the agent remembering
context across the local: boundary. The gateway doesn't track the
original user JID through the escalation round-trip.

**Fix — propagate origin through local: responses:**

When the parent responds to `local:worker`, the escalation XML
carried `reply_to` and `reply_id`. The gateway can use these to
annotate the local: message stored in the DB, so when the worker
processes it, the gateway injects the origin context:

```xml
<escalation_response origin_jid="telegram:12345"
                     origin_msg_id="567">
  Parent's response text
</escalation_response>
```

The worker's agent sees the origin and can `send_message` with
the correct JID and `replyTo`. The chunk-chaining mechanism
(section B) handles threading from there.

Alternatively, the gateway could auto-forward: when a local:
response is the final hop (worker has no further parent), the
gateway bypasses the agent and sends directly to `reply_to` JID
with `replyTo: reply_id`. This is simpler but removes the
worker's ability to filter or augment the parent's response.

**Decision needed**: agent-mediated forwarding (annotate + let
agent decide) vs gateway auto-forward (bypass agent on final hop).
Agent-mediated is more flexible; auto-forward is more reliable.

### G. Platform threads

Discord, Slack, and Telegram (topics) support native threads.
These provide true visual isolation — each user's messages are
in their own thread, no interleaving.

This is subsumed by the routing model. Reply-threading (this spec)
plus `{sender}` routing already creates virtual per-user threads.
Platform threads would be an optimization on top — replacing
reply-chain visual noise with clean thread isolation.

**How it maps:**

```
Current:    {sender} route → per-user group folder
                           → reply-chain in shared channel
Platform:   {sender} route → per-user group folder
                           → dedicated platform thread per user
```

The routing, batching, and cursor mechanisms are identical.
The only difference is at the channel send layer: instead of
`sendMessage(chatJid, text, { replyTo })` sending to the main
channel with reply threading, it would `sendMessage(threadJid,
text)` to a dedicated thread.

**Implementation sketch:**

- `NewMessage.thread` field already exists (used by email)
- Discord/Telegram channels could populate it with thread ID
- Route resolution could include thread creation: when `{sender}`
  resolves and no thread exists for that sender, create one
- `chatJid` encoding: `discord:channel_id` stays for the main
  channel; `discord:thread_id` for per-user threads
- Thread JID would be registered as a route target just like
  group folders are today

**Not in scope for this spec.** Reply-threading (sections A-E)
ships first. Platform threads are a channel-layer enhancement
that layers on top without changing the routing model.

## Code changes

| File                       | Change                                         | Size      |
| -------------------------- | ---------------------------------------------- | --------- |
| `src/types.ts`             | `sendMessage` returns `Promise<string\|undef>` | ~1 line   |
| `src/channels/telegram.ts` | return `msg.message_id` from `sendMessage`     | ~3 lines  |
| `src/channels/discord.ts`  | return `msg.id` from `sendMessage`             | ~3 lines  |
| `src/channels/whatsapp.ts` | return `msg.key.id` from `sendMessage`         | ~3 lines  |
| `src/channels/local.ts`    | return `id` from `sendMessage`                 | ~1 line   |
| `src/index.ts`             | `delegateToChild/Parent` + `messageId` param   | ~5 lines  |
| `src/index.ts`             | `delegateToGroup` reply chaining               | ~8 lines  |
| `src/index.ts`             | `processGroupMessages` reply chaining          | ~5 lines  |
| `src/index.ts`             | message loop: per-sender split                 | ~25 lines |
| `src/index.ts`             | pass `messageId` at delegation callsites       | ~4 lines  |
| `src/ipc.ts`               | `send_reply` auto-inject `replyTo` + chaining  | ~10 lines |
| `src/action-registry.ts`   | `sendMessage` return type update               | ~1 line   |

No schema changes. No new config. No new route types.

## Implementation order

Sections A-E are self-contained and can ship together. Sections
F and G depend on messaging changes that need to be worked through
after A-E land:

1. **A-E**: sendMessage return type, chunk chaining, delegation
   messageId, IPC auto-inject, per-sender batching
2. **F**: escalation origin propagation (requires messaging design
   for local: → user forwarding)
3. **G**: platform threads (channel-layer enhancement, separate spec)

## Open decisions

- **Section F**: agent-mediated forwarding vs gateway auto-forward
  for escalation responses. Agent-mediated is more flexible;
  auto-forward is more reliable.
