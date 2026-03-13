# Chat-Bound Sessions

**Status**: shipped

One container per folder, strictly serial within folder, parallel across folders.
All I/O via IPC files — no stdin. File deletion is acknowledgment.

## Model

- **Container = folder**. One active container per folder at a time.
- **Same folder, multiple JIDs**: queued. One JID at a time.
- **Different folders**: parallel. `root` and `atlas/support` run simultaneously.

## IPC directory

Per-folder directory. Folder path encoded: `/` → `-`, `-` → `--`.

```
/data/ipc/<encoded-folder>/
  start.json     ← config (gateway writes before spawn)
  input/         ← message files (gateway writes, container deletes)
    <id>.json    ← { text: "...", chatJid: "..." }
```

Examples:

```
root           → /data/ipc/root/
atlas/support  → /data/ipc/atlas-support/
atlas-v2       → /data/ipc/atlas--v2/
```

### start.json

```typescript
{
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  assistantName: string;
  channelName?: string;
  annotations?: string[];
}
```

### Message file

```typescript
{
  id: string; // DB message ID or timestamp
  text: string;
  chatJid: string;
}
```

## Lifecycle

**Gateway spawns container:**

```
1. Get pending messages for JID from DB
2. Clear input/
3. Write start.json
4. Write message files to input/ (track which IDs written)
5. Spawn container
```

**Container runs:**

```
1. Read start.json
2. Poll input/ for messages
3. Process message via SDK query
4. Delete message file (acknowledgment)
5. Repeat until input/ empty
6. Exit
```

**Gateway on container exit:**

```
1. For each message ID we wrote:
   - File deleted → mark delivered in DB
   - File exists → stays pending (retry next run)
2. Clear input/
3. Next JID in queue gets its turn
```

## Delivery guarantees

- **File deleted = processed.** Container deletes after successful processing.
- **File exists = not processed.** Stays pending, retried on next container for this JID.
- **Crash = partial.** Processed messages (deleted files) are delivered. Unprocessed (remaining files) retry.
- **No duplicates.** Each message processed at most once per container run.

## send_reply action

```typescript
export const sendReply: Action = {
  name: 'send_reply',
  description: 'Reply to the current conversation.',
  input: z.object({ text: z.string() }),
  async handler(raw, ctx) {
    if (!ctx.chatJid) throw new Error('no bound chat JID');
    await ctx.sendMessage(ctx.chatJid, raw.text);
    return { sent: true };
  },
};
```

`chatJid` on `ActionContext` — from the message file being processed.

## Parallelism

| Scenario                         | Behavior                               |
| -------------------------------- | -------------------------------------- |
| JID1 → folder A, JID2 → folder A | Serial. JID2 waits.                    |
| JID1 → folder A, JID2 → folder B | Parallel. Separate containers.         |
| JID1 → folder A, JID1 → folder B | Parallel. Same JID, different folders. |

## Changes required

```
container/agent-runner/src/index.ts
  - Remove stdin reading
  - Read start.json on startup
  - Poll input/ for messages
  - Delete file after processing each message

src/container-runner.ts
  - Write start.json before spawn
  - Write message files to input/
  - Remove stdin piping
  - Track written message IDs

src/group-queue.ts
  - Clear input/ before spawn
  - Check remaining files on exit
  - Mark delivered/pending based on file presence

src/index.ts
  - Remove IDLE_TIMEOUT and idle timer

src/action-registry.ts
  - Add chatJid to ActionContext

src/actions/messaging.ts
  - Add send_reply action

src/ipc.ts
  - Extract chatJid from current message
```

## Implementation order

1. IPC file protocol in agent-runner (start.json, poll input/, delete on process)
2. Gateway write side (clear, write start.json + messages, track IDs)
3. Gateway exit handling (check files, mark delivered/pending)
4. Remove stdin from container-runner
5. chatJid on ActionContext + send_reply action
6. Remove IDLE_TIMEOUT
