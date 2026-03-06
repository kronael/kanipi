# Channels

The channel abstraction — interface, callbacks, activation, per-channel
coverage, threading, and implementation notes. Single source of truth.

## Principle

No token → channel never loads. No explicit enable flags.

## Activation

| Channel  | Enabled when                               | JID prefix  |
| -------- | ------------------------------------------ | ----------- |
| telegram | `TELEGRAM_BOT_TOKEN` set                   | `telegram/` |
| whatsapp | `store/auth/creds.json` exists (QR paired) | `whatsapp/` |
| discord  | `DISCORD_BOT_TOKEN` set                    | `discord/`  |
| email    | `EMAIL_IMAP_HOST` set                      | `email/`    |
| web      | always (slink HTTP)                        | `web:`      |

## Channel interface

Defined in `src/types.ts`:

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

`ownsJid()` returns true for JIDs with the channel's prefix. Router
iterates channels to find the owner for each outbound message.

### Command support (open)

Channels that support native command registration declare it via
optional methods (see `specs/v1/commands.md`):

```typescript
interface Channel {
  // ...existing...
  supportsNativeCommands?: boolean;
  registerCommands?(handlers: CommandHandler[]): Promise<void>;
}
```

Telegram and Discord register natively; WhatsApp, email, web use
text prefix matching only.

## Inbound callbacks

```typescript
type OnInboundMessage = (
  chatJid: string,
  message: NewMessage,
  attachments?: RawAttachment[],
  download?: AttachmentDownloader,
) => void;

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

## NewMessage

```typescript
interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name?: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  replyTo?: string; // channel-native reply handle (open — not yet in code)
}
```

## Implementations

| Channel  | File                       | Library    | Notes                                          |
| -------- | -------------------------- | ---------- | ---------------------------------------------- |
| telegram | `src/channels/telegram.ts` | grammy     | long-poll, @mention translation                |
| whatsapp | `src/channels/whatsapp.ts` | baileys    | QR auth, LID translation, offline queue        |
| discord  | `src/channels/discord.ts`  | discord.js | @mention translation, 2000-char split          |
| email    | `src/channels/email.ts`    | imapflow   | IMAP IDLE + SMTP, threading via email_threads  |
| web      | `src/channels/web.ts`      | built-in   | SSE push to slink frontend, no inbound parsing |

Full email channel spec: `specs/v1/email.md`.

## Inbound event handlers

| Channel  | Events                                                                             |
| -------- | ---------------------------------------------------------------------------------- |
| telegram | text, photo, video, voice, audio, document, sticker, location, contact (9 `.on()`) |
| whatsapp | connection.update, creds.update, messages.upsert (3 `.ev.on()`)                    |
| discord  | messageCreate (1 `.on()`)                                                          |
| email    | IMAP IDLE loop → fetchUnseen                                                       |
| web      | HTTP POST from slink frontend (handled in `src/slink.ts`)                          |

## Interface coverage

| Method             | telegram | whatsapp | discord | email | web |
| ------------------ | -------- | -------- | ------- | ----- | --- |
| `sendMessage`      | yes      | yes      | yes     | yes   | yes |
| `setTyping`        | yes      | yes      | no      | no    | no  |
| `sendDocument`     | yes      | yes      | yes     | no    | no  |
| `sendMessage` opts | no       | no       | no      | no    | no  |
| threading inbound  | no       | no       | no      | yes   | n/a |
| threading outbound | no       | no       | no      | yes   | n/a |
| native commands    | no       | no       | no      | no    | no  |

## Threading

Threading is a first-class channel concern. When a user messages inside
a thread or replies to a specific message, the channel should:

1. Populate `NewMessage.replyTo` with the channel-native handle.
2. Pass `opts.replyTo` to `sendMessage` so the response lands in
   the same thread.

Channel-native handles:

| Channel  | `replyTo` value                 | `sendMessage` behaviour      |
| -------- | ------------------------------- | ---------------------------- |
| telegram | `message_id` as string          | `reply_to_message_id`        |
| discord  | thread channel ID or message ID | send into thread / reply     |
| whatsapp | quoted message key              | `quoted` field in Baileys    |
| email    | root `Message-ID` header value  | `In-Reply-To` + `References` |

### Prompt format

Reply context is injected into the `<messages>` block by
`formatMessages()` as a child element of `<message>`:

```xml
<message sender="Alice" time="2026-03-05T10:34Z" ago="2m">
  <in_reply_to sender="Bob" time="2026-03-05T10:32Z" ago="4m">sure, what do you need</in_reply_to>
  hey follow up on that
</message>
```

`time` and `ago` on both elements — agent cannot infer elapsed time
from ISO timestamps alone. `ago` computed at inject time. `in_reply_to`
body is the quoted message text, truncated to 120 chars. Always
available — looked up from DB at inject time.

### WhatsApp raw storage

Baileys requires the full `WAMessage` object for `quoted` on outbound.
Store the raw object as JSON in `messages.raw` (nullable TEXT column)
on inbound. Look up by stanza ID at send time. Survives restarts.

### Forum topics and threads

Telegram `message_thread_id` and Discord thread channels are room
partitions, not reply chains. Handled separately from `replyTo` —
see `specs/v1/worlds.md` for topic/thread routing.

### Prior art

**OpenClaw**: annotates reply context inline, `replyToMode` config
(`off`/`first`/`all`) for outbound reply targeting. Sensible default:
`first`. Telegram forum topic insight — thread ID partitions room.

**ElizaOS**: internal UUID `content.inReplyTo` hashed from platform
message ID. WhatsApp threading not implemented.

### Email threading

Implemented. `email_threads` table maps `message_id → thread_id →
root_msg_id`. See `specs/v1/email.md` for full details. Generalise
to `channel_threads` only when a second channel needs it.

## To ship (message-threading)

1. **`src/types.ts`** — add `replyTo` to `NewMessage`

2. **`src/types.ts`** — add `SendOpts` to `sendMessage` signature

3. **Telegram** — populate `replyTo` from
   `ctx.message.reply_to_message?.message_id?.toString()`.
   On outbound: `reply_parameters: { message_id: parseInt(opts.replyTo) }`

4. **WhatsApp** — populate `replyTo` from
   `msg.message?.extendedTextMessage?.contextInfo?.stanzaId`.
   On outbound: pass `quoted` from `messages.raw` lookup.

5. **Discord** — populate `replyTo` from
   `message.reference?.messageId`. On outbound:
   `channel.send({ content, reply: { messageReference: replyTo } })`

6. **`messages.raw` column** — `ALTER TABLE messages ADD COLUMN
raw TEXT`. WhatsApp populates on inbound, others leave null.

7. **`formatMessages()`** — emit `<in_reply_to>` child element
   when `replyTo` is set. Add `time` and `ago` attributes to
   `<message>` elements.

## v2: plugin loading

Currently all channels are compiled in and conditionally instantiated.
Future: dynamic import so unused channel dependencies aren't loaded.
