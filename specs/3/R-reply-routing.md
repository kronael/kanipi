---
status: shipped (A-E), draft (F-G)
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

**Current flow:**

```
1. Worker processes telegram:12345 (messageId="567")
2. Worker calls escalate_group(prompt, chatJid="telegram:12345")
3. escalate_group wraps in <escalation reply_to="telegram:12345"
   reply_id="567">
4. delegateToParent("atlas", xml, "local:atlas/tg-98765", depth)
5. Parent responds → LocalChannel stores in local:atlas/tg-98765
6. Message loop picks up local:atlas/tg-98765 → worker processes
7. Worker's chatJid is now "local:atlas/tg-98765" (not telegram:)
   → send_reply goes to local channel, not user
   → worker must remember telegram:12345 from session transcript
```

**Problem**: the worker must remember the original user JID and
messageId across the local: boundary. This works when session
context is preserved but is fragile — no structural guarantee.

**Fix — annotate local: responses with origin:**

The `escalate_group` action already embeds `reply_to` and
`reply_id` in the XML sent to the parent. When the parent
responds and the gateway stores the response in LocalChannel,
wrap the stored message with origin metadata:

```xml
<escalation_response origin_jid="telegram:12345"
                     origin_msg_id="567">
  Parent's response text
</escalation_response>
```

The worker agent sees the origin and uses `send_message` with
the correct JID and `replyTo`. Chunk chaining (section B)
handles subsequent threading.

**Implementation:**

The gateway needs to know that a response to `local:X` is an
escalation response. Two approaches:

1. **Track escalation metadata on the queue entry.** When
   `delegateToGroup` runs with `label='escalate'`, store
   `{reply_to, reply_id}` alongside the task. When the
   streaming callback fires, wrap the response text before
   storing via LocalChannel.

2. **Parse the input prompt.** The `<escalation>` XML is the
   prompt. Extract `reply_to` and `reply_id` from it when
   storing the response. Simpler but couples to XML format.

Option 1 is cleaner. `delegateToGroup` already has `label`
to distinguish escalate from delegate. Add `escalationOrigin?:
{jid: string, messageId: string}` to the function signature.
`escalate_group` passes it; the streaming callback uses it
to wrap stored messages.

**Code changes:**

| File                     | Change                                     |
| ------------------------ | ------------------------------------------ |
| `src/index.ts`           | `delegateToGroup` gains `escalationOrigin` |
| `src/index.ts`           | streaming callback wraps local: responses  |
| `src/actions/groups.ts`  | `escalate_group` passes origin metadata    |
| `src/action-registry.ts` | `delegateToParent` gains origin param      |
| `src/ipc.ts`             | `IpcDeps.delegateToParent` signature       |

### G. Platform threads

Discord, Slack, and Telegram (topics) support native threads.
These provide true visual isolation per user — no interleaving.

Reply-threading (A-E) plus `{sender}` routing already creates
virtual per-user threads via reply chains. Platform threads
replace reply-chain noise with clean thread isolation.

**How it maps:**

```
Current:    {sender} route → per-user group → reply-chain in channel
Platform:   {sender} route → per-user group → dedicated thread per user
```

Routing, batching, and cursor mechanisms are identical. The
difference is at the channel send layer: `sendMessage(threadJid,
text)` to a dedicated thread instead of reply-chaining in the
main channel.

**Design:**

Thread lifecycle:

- On first message from a sender in a `{sender}`-routed channel,
  create a platform thread (Discord: `channel.threads.create()`,
  Telegram: `forumTopicCreate`)
- Store thread ID in routes table: `jid → thread_jid` mapping
- Subsequent messages from same sender go to existing thread
- Thread JID encoded as `discord:thread_id` / `telegram:thread_id`

Mapping to existing primitives:

- `NewMessage.thread` field already exists (used by email)
- Discord/Telegram channels populate it with thread ID on ingest
- Route resolution includes thread lookup: sender → thread JID
- `chatJid` for the group becomes the thread JID, not the main
  channel — all existing reply-threading works unchanged

Thread creation:

- Discord: `TextChannel.threads.create({ name: senderName })`
- Telegram: requires forum-enabled group (`forumTopicCreated`)
- WhatsApp: no thread support — reply-chain only
- Threads are per-sender per-channel, stored in routes table

**Code changes:**

| File                       | Change                                     |
| -------------------------- | ------------------------------------------ |
| `src/db.ts`                | thread_jid column in routes or new table   |
| `src/channels/discord.ts`  | thread create/lookup on `{sender}` resolve |
| `src/channels/telegram.ts` | forum topic create/lookup                  |
| `src/router.ts`            | thread JID resolution in route matching    |
| `src/index.ts`             | use thread JID as chatJid when available   |

No changes to routing model — threads are a channel-layer
optimization that plugs into existing `{sender}` routing.

## Shipped code changes (A-E)

| File                       | Change                                                |
| -------------------------- | ----------------------------------------------------- |
| `src/types.ts`             | `sendMessage` returns `Promise<string\|undef>`        |
| `src/channels/*.ts`        | return sent message ID from `sendMessage`             |
| `src/index.ts`             | `delegateToChild/Parent` + `messageId` param          |
| `src/index.ts`             | streaming callbacks: chunk chaining via `lastSentId`  |
| `src/index.ts`             | message loop + processGroupMessages: per-sender split |
| `src/actions/messaging.ts` | `send_reply` auto-injects `replyTo` from context      |
| `src/actions/groups.ts`    | `delegate_group` passes `ctx.messageId`               |
| `src/action-registry.ts`   | `sendMessage` return type, delegation `messageId`     |
| `src/ipc.ts`               | `IpcDeps` signature updates                           |

## Implementation order

1. **A-E**: shipped (5500182)
2. **F**: escalation origin annotation — small, self-contained
3. **G**: platform threads — larger, separate spec recommended
