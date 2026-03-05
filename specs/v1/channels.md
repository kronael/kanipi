# kanipi channel strategy — shipped

## Principle

No token → channel never loads. No explicit enable flags.

## Activation

| Channel  | Enabled when                               | JID prefix |
| -------- | ------------------------------------------ | ---------- |
| telegram | `TELEGRAM_BOT_TOKEN` set                   | `tg:`      |
| whatsapp | `store/auth/creds.json` exists (QR paired) | `wa:`      |
| discord  | `DISCORD_BOT_TOKEN` set                    | `discord:` |
| email    | `EMAIL_IMAP_HOST` set                      | `email:`   |

## Channel interface

```typescript
interface Channel {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  sendMessage(jid: string, text: string, opts?: SendOpts): Promise<void>;
  setTyping?(jid: string, on: boolean): Promise<void>;
  sendDocument?(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void>;
}

interface SendOpts {
  replyTo?: string; // channel-native thread/reply handle
}
```

`ownsJid()` returns true for JIDs with the channel's prefix. Router iterates
channels to find the owner for each outbound message.

## Inbound callbacks

```typescript
// Delivers an inbound message to the gateway.
// attachments + download are set for media entering the enricher pipeline.
type OnInboundMessage = (
  chatJid: string,
  message: NewMessage,
  attachments?: RawAttachment[],
  download?: AttachmentDownloader,
) => void;

// Reports chat metadata (name, channel, group flag).
// Channels that deliver names inline (Telegram) pass name here.
// Channels that sync separately (WhatsApp) omit it.
type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

interface ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}
```

## Threading

Threading is a first-class channel concern. When a user messages inside a
thread or replies to a specific message, the channel should:

1. Populate `NewMessage.replyTo` with the channel-native handle.
2. Pass `opts.replyTo` to `sendMessage` so the response lands in the same thread.

Channel-native handles:

| Channel  | `replyTo` value                 | `sendMessage` behaviour      |
| -------- | ------------------------------- | ---------------------------- |
| telegram | `message_id` as string          | `reply_to_message_id`        |
| discord  | thread channel ID or message ID | send into thread / reply     |
| whatsapp | quoted message key              | `quoted` field in Baileys    |
| email    | root `Message-ID` header value  | `In-Reply-To` + `References` |

### Prior art

**OpenClaw** (separate project, not our upstream — for reference only):

- Inbound: extracts reply context and **annotates the message body inline**
  so the agent sees it without a lookup. We use XML consistent with prompt
  format, as a child element of `<message>`:

  ```xml
  <message sender="Alice" time="2026-03-05T10:34Z" ago="2m">
    <in_reply_to sender="Bob" time="2026-03-05T10:32Z" ago="4m">sure, what do you need</in_reply_to>
    hey follow up on that
  </message>
  ```

  `time` and `ago` on both elements — agent cannot infer elapsed time from
  ISO timestamps alone. `ago` computed at inject time from message timestamp.
  The `in_reply_to` body is the quoted message text (truncated if long).

- OpenClaw uses a `replyToMode` config (`off` / `first` / `all`) for
  outbound — controls whether only the first response chunk carries
  `reply_to_message_id` or all of them. Sensible default: `first`.

- **Telegram forum topics**: `message_thread_id` must be handled separately
  from `replyTo` — setting it on DMs causes a 400 error. Forum topic ID
  partitions the room, not the reply chain.

- **WhatsApp outbound**: Baileys `sock.sendMessage(jid, { text }, { quoted: originalMsg })`
  requires the full `WAMessage` object, not just the stanza ID string. Need
  an in-memory cache of recent messages (keyed by stanza ID) to reconstruct
  the quoted object at send time.

**ElizaOS**: uses an internal UUID (`content.inReplyTo`) hashed from the
platform message ID. Same Telegram forum topic insight — thread ID → room
partition, not `inReplyTo`. WhatsApp threading also not implemented there.

**Prompt format note**: OpenClaw may use "moded XML" (XML with mode or type
attributes on the wrapper element). Review `specs/v1/prompt-format.md` when
implementing to decide how `<reply_to>` fits into the `<message>` element —
likely as a child element or `reply_to` attribute with body as nested content.

### Current state

Email is the only channel with threading implemented, via `email_threads` in
`db.ts` (`message_id → thread_id → root_msg_id`). All other channels drop
reply context — inbound replies in group chats arrive as plain messages with
no `replyTo` set.

### To ship

**1. `src/types.ts`** — add `replyTo` to `NewMessage`:

```typescript
export interface NewMessage {
  // ...existing fields...
  replyTo?: string; // channel-native reply handle; omit if not a reply
}
```

**2. Telegram** (`src/channels/telegram.ts`) — grammy exposes
`ctx.message.reply_to_message?.message_id`. Populate on inbound:

```typescript
replyTo: ctx.message.reply_to_message?.message_id?.toString(),
```

On outbound `sendMessage` with `opts?.replyTo`:

```typescript
await ctx.api.sendMessage(chatId, text, {
  reply_parameters: { message_id: parseInt(opts.replyTo) },
});
```

**3. WhatsApp** (`src/channels/whatsapp.ts`) — baileys exposes
`msg.message?.extendedTextMessage?.contextInfo?.stanzaId` as the quoted
message ID. Populate on inbound:

```typescript
replyTo: msg.message?.extendedTextMessage?.contextInfo?.stanzaId,
```

On outbound with `opts?.replyTo`, pass as `quoted` to baileys `sendMessage`.
Baileys requires the full `WAMessage` object (raw protobuf), not just the
stanza ID. Store the raw object as JSON in `messages.raw` (nullable column)
on inbound — look it up by stanza ID at send time. Survives restarts, no
in-memory cache needed. Without it, fall back to plain send (no quote bubble).

**4. Discord** — thread channel ID already available as the channel JID.
Reply-to within a channel: `interaction.message?.id`. Lower priority.

**5. `messages.raw` column** — add nullable `raw TEXT` to the `messages`
table via migration (`ALTER TABLE messages ADD COLUMN raw TEXT`). WhatsApp
populates with `JSON.stringify(msg)` on inbound. Other channels leave null.
On outbound reply: `JSON.parse(raw)` and pass as `quoted` to Baileys.

**6. `email_threads`** — generalise to `channel_threads` only when a second
channel needs it. Email threading stays on `email_threads` for now.

**7. `formatMessages()`** — emit `<in_reply_to sender time ago>` as child
element of `<message>` when `NewMessage.replyTo` is set. Add `time` and `ago`
attributes to `<message>` itself. `ago` = human-readable elapsed ("2m", "1h",
"3d") computed from message timestamp at format time.

## Implementations

| Channel  | File                       | Notes                                                        |
| -------- | -------------------------- | ------------------------------------------------------------ |
| telegram | `src/channels/telegram.ts` | grammy, long-poll, /chatid + /ping, @mention translation     |
| whatsapp | `src/channels/whatsapp.ts` | baileys, QR auth, LID translation, offline queue, group sync |
| discord  | `src/channels/discord.ts`  | discord.js, !chatid, @mention translation, 2000-char split   |
| email    | `src/channels/email.ts`    | IMAP IDLE + SMTP, threading via email_threads table          |

## Optional interface coverage

| Method         | telegram | whatsapp | discord | email |
| -------------- | -------- | -------- | ------- | ----- |
| `setTyping`    | ✓        | ✓        | ✗       | ✗     |
| `sendDocument` | ✓        | ✓        | ✓       | ✗     |
| threading      | ✗ open   | ✗ open   | ✗ open  | ✓     |

## v2: plugin loading

Currently all channels are compiled in and conditionally instantiated.
Future: dynamic import so unused channel dependencies aren't loaded at all.
