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
Requires fetching the original message object — may need to store recent
messages in memory or skip quoted object and send plain reply.

**4. Discord** — thread channel ID already available as the channel JID.
Reply-to within a channel: `interaction.message?.id`. Lower priority.

**5. `email_threads`** — generalise to `channel_threads` only when a second
channel needs it. Email threading stays on `email_threads` for now.

**6. `prompt-format.md`** — `reply_to` attribute on `<message>` is already
specced; needs to be emitted by `formatMessages()` once `NewMessage.replyTo`
is populated.

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
