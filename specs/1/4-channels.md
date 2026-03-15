---
status: shipped
---

# Channels

Interface, callbacks, activation, threading.

## Activation

No token = channel never loads.

| Channel  | Enabled when                   | JID prefix | Example              |
| -------- | ------------------------------ | ---------- | -------------------- |
| telegram | `TELEGRAM_BOT_TOKEN` set       | `tg:`      | `tg:-100123456`      |
| whatsapp | `store/auth/creds.json` exists | (native)   | `123@g.us`           |
| discord  | `DISCORD_BOT_TOKEN` set        | `discord:` | `discord:1234567890` |
| email    | `EMAIL_IMAP_HOST` set          | `email:`   | `email:a1b2c3d4e5f6` |
| web      | always (slink HTTP)            | `web:`     | `web:main`           |

JID format is `scheme:id` (URI-like). WhatsApp uses native
Baileys JIDs (`@g.us`, `@s.whatsapp.net`). `ownsJid()` does
prefix matching. See `worlds.md` for prefix expansion
(`tg:` → `telegram:`, WhatsApp wrapping).

## Channel interface

`src/types.ts`:

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
  supportsNativeCommands?: boolean;
  registerCommands?(handlers: CommandHandler[]): Promise<void>;
}

interface SendOpts {
  replyTo?: string;
}
```

`ownsJid()` — prefix match. Router iterates to find owner.

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
  replyTo?: string; // channel-native reply handle (open)
}
```

## Implementations

| Channel  | File                       | Library    | Notes                           |
| -------- | -------------------------- | ---------- | ------------------------------- |
| telegram | `src/channels/telegram.ts` | grammy     | long-poll, @mention translation |
| whatsapp | `src/channels/whatsapp.ts` | baileys    | QR auth, LID, offline queue     |
| discord  | `src/channels/discord.ts`  | discord.js | @mention, 2000-char split       |
| email    | `src/channels/email.ts`    | imapflow   | IMAP IDLE + SMTP threading      |
| web      | `src/channels/web.ts`      | built-in   | SSE push, no inbound parsing    |

Full email spec: `specs/1/8-email.md`.

## Interface coverage

| Method        | tg  | wa  | discord | email | web |
| ------------- | --- | --- | ------- | ----- | --- |
| sendMessage   | yes | yes | yes     | yes   | yes |
| setTyping     | yes | yes | no      | no    | no  |
| sendDocument  | yes | yes | yes     | no    | no  |
| threading in  | no  | no  | no      | yes   | n/a |
| threading out | no  | no  | no      | yes   | n/a |
| native cmds   | no  | no  | no      | no    | no  |

## Threading

`replyTo` is per-message. Topic/thread ID is a JID segment
(see `worlds.md`).

Channel-native handles:

| Channel  | `replyTo` value     | outbound behaviour           |
| -------- | ------------------- | ---------------------------- |
| telegram | `message_id` string | `reply_to_message_id`        |
| discord  | thread/message ID   | send into thread / reply     |
| whatsapp | quoted message key  | `quoted` in Baileys          |
| email    | root `Message-ID`   | `In-Reply-To` + `References` |

### Prompt format

Reply context in `<messages>` block:

```xml
<message sender="Alice" time="..." ago="2m">
  <in_reply_to sender="Bob" time="..." ago="4m">
    sure, what do you need
  </in_reply_to>
  hey follow up on that
</message>
```

`ago` computed at inject time. `in_reply_to` body truncated
to 120 chars, looked up from DB.

### WhatsApp raw storage

Store full `WAMessage` as JSON in `messages.raw` (nullable
TEXT). Needed for `quoted` on outbound. Survives restarts.

### Forum topics and threads

Telegram `message_thread_id` and Discord thread channels are
room partitions, not reply chains. See `worlds.md`.

### Email threading

Implemented. `email_threads` table maps
`message_id -> thread_id -> root_msg_id`.
See `specs/1/8-email.md`. Generalise to `channel_threads`
only when a second channel needs it.

## Resilience

Every channel polling/event loop must either recover or crash.
Silent death is never acceptable — systemd restarts the process.

**Rule**: if a subsystem's loop fails, log ERROR, attempt recovery
with backoff, crash after N consecutive failures.

| Channel  | Error handling                                                          | Recovery                |
| -------- | ----------------------------------------------------------------------- | ----------------------- |
| telegram | `bot.start()` promise `.catch()` → `process.exit(1)`                    | crash (systemd restart) |
| whatsapp | `connection: close` → `connectInternal()` retry, crash after 2 failures | reconnect then crash    |
| discord  | `client.on('error')` → `process.exit(1)`                                | crash (systemd restart) |
| email    | exponential backoff in `idleLoop()`, caps at 60s                        | reconnect with backoff  |

Non-channel subsystems:

- **IPC watcher** — `pollForNewGroups()` try-catch with setTimeout
  outside the catch (loop survives exceptions)
- **Scheduler** — try-catch continues loop unconditionally
- **Web proxy** — server bind errors crash the process (acceptable)

## v2: plugin loading

Dynamic import so unused channel deps aren't loaded.
