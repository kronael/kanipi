# Chat-Bound Sessions

**Status**: spec

One container per folder, strictly serial. Containers exit when SDK query
completes and input is empty. All I/O via IPC files — no stdin.

## Model

- **Container = folder**. One active container per folder at a time, always serial.
- **Multiple JIDs → same folder**: queued. A second JID's message waits until
  the current container exits.
- **Same JID → different folders**: parallel. JID1 can hit `root` and
  `atlas/support` simultaneously — those are different folder containers.

## IPC directory

```
/workspace/ipc/
  start.json          ← config written by gateway before spawn
  input/              ← message files (gateway writes, container reads)
    <timestamp>.json  ← { text: "...", chatJid: "..." }
  exiting             ← sentinel (empty = alive, "exiting" = shutting down)
```

### start.json schema

```typescript
{
  sessionId?: string;       // SDK resume
  groupFolder: string;      // context
  chatJid: string;          // source JID for first message
  assistantName: string;    // bot name
  channelName?: string;     // telegram/discord/etc
  annotations?: string[];   // diary injection etc
}
```

### Message file schema

```typescript
{
  text: string; // message content
  chatJid: string; // source JID
}
```

## Container lifecycle

```
1. Gateway writes start.json + initial message(s) to input/
2. Gateway spawns container
3. Container reads start.json
4. Container creates empty exiting file
5. Container polls input/, processes messages via SDK query
6. SDK query finishes, input/ empty → exit protocol
```

## Exit protocol

Lock-based handoff to prevent message loss.

**Gateway delivers message:**

```
flock(exiting, LOCK_EX)
if read(exiting) == "exiting":
  unlock
  return QUEUE_FOR_NEXT        // container exiting, queue for next
write message to input/
unlock
signal container (SIGUSR1)
return DELIVERED
```

**Container exits:**

```
flock(exiting, LOCK_EX)
write(exiting, "exiting")
unlock
drain input/ for remaining messages
process drained messages (final query if needed)
exit
```

**Why this works:**

- Lock ensures mutual exclusion on state transitions
- Gateway has lock → writes message → container can't mark exiting → message seen
- Container has lock → marks exiting → gateway sees "exiting" → queues for next
- Container drains after writing "exiting" → catches messages that arrived before lock

## send_reply action

```typescript
export const sendReply: Action = {
  name: 'send_reply',
  description: 'Reply to the current conversation.',
  input: z.object({ text: z.string() }),
  async handler(raw, ctx) {
    const { text } = z.object({ text: z.string() }).parse(raw);
    if (!ctx.chatJid) throw new Error('no bound chat JID');
    await ctx.sendMessage(ctx.chatJid, text);
    return { sent: true };
  },
};
```

`chatJid` on `ActionContext` — extracted from message file being processed.

## Task containers

Tasks store `chat_jid` at registration. Pass `task.chat_jid` in start.json.

## Changes required

```
container/agent-runner/src/index.ts
  - Remove stdin reading
  - Read start.json on startup
  - Poll input/ for messages
  - Implement exit protocol with flock

src/container-runner.ts
  - Write start.json before spawn
  - Write initial messages to input/
  - Remove stdin piping

src/group-queue.ts
  - Implement lock protocol for message delivery
  - Check exiting sentinel before writing

src/config.ts
  - Remove IDLE_TIMEOUT

src/index.ts
  - Remove idle timer setTimeout logic

src/action-registry.ts
  - Add chatJid to ActionContext

src/ipc.ts
  - Extract chatJid from current message context

src/actions/messaging.ts
  - Add send_reply action
```

## Implementation order

1. IPC file protocol in agent-runner (read start.json, poll input/, exit protocol)
2. Gateway write side (start.json, message files, lock protocol)
3. Remove stdin piping from container-runner
4. chatJid on ActionContext + send_reply action
5. Remove IDLE_TIMEOUT and idle timer
