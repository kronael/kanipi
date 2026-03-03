# Email channel (v1)

IMAP inbound + SMTP outbound. Generic mail provider support.

## Enabling

Enabled by presence of `EMAIL_IMAP_HOST` + `EMAIL_ACCOUNT` + `EMAIL_PASSWORD`
in `.env`. Registered in `index.ts` same as other channels:

```typescript
if (EMAIL_IMAP_HOST) {
  const email = new EmailChannel(channelOpts);
  channels.push(email);
  await email.connect();
}
```

## Channel class

`src/channels/email.ts` — `EmailChannel implements Channel`:

- `name = 'email'`
- `connect()` — open IMAP, start IDLE loop. Retries with exponential
  backoff (1s, 2s, 4s… cap 60s) on initial connect failure.
- `disconnect()` — close IMAP + SMTP connections
- `sendMessage(jid, text)` — look up outbound info from DB by
  `thread_id`, send SMTP reply

## Group routing

All email messages route to the first registered group with
`requires_trigger=0` (i.e. the `main` group). Same behaviour as the
web channel.

## Source and sink

`EMAIL_ACCOUNT` is the bot's inbox — the channel identity admitted into
the gateway. Anyone emailing that address becomes a sender.

- **Inbound**: IMAP IDLE on `EMAIL_ACCOUNT`'s INBOX. Server notifies
  on new mail; client issues `FETCH` immediately. Falls back to 60s
  poll if IDLE unsupported (rare).
- **Outbound**: SMTP reply from `EMAIL_ACCOUNT` via `In-Reply-To` +
  `References` headers.
- Single account per instance.

## IMAP IDLE

`imapflow` exposes `.idle()` which sends the IDLE command and resolves
when the server pushes `EXISTS` or `EXPUNGE`. Loop:

```typescript
while (connected) {
  await client.idle(); // blocks until server pushes
  await fetchUnseen();
}
```

`fetchUnseen()`: search INBOX for messages without the `\Seen` flag
that are absent from `email_threads` (double guard against re-fetch
on restart). Mark each fetched message `\Seen` immediately after
storing to `email_threads`.

On any error (connect or `idle()`), close connection and reconnect
with exponential backoff (1s, 2s, 4s… cap 60s).

## JID format

`email:<thread_id>` where `thread_id` = first 12 hex chars of
`sha256(root_message_id)`.

New thread (no `In-Reply-To` match) → hash the inbound `Message-ID`
as thread root.
Existing thread → look up `message_id → thread_id` in DB via
`In-Reply-To` header → reuse thread_id.

## Sender identity

Follows the same sub-prefix pattern as auth providers:

```
sender      = "email:user@example.com"   // from-address
sender_name = "Alice"                    // display name from From header,
                                         // or from-address if absent
```

Cross-channel linking in v2 — see `specs/v2/identities.md`.

## Message metadata

Email carries rich metadata injected as context before the body:

```
From: Alice <alice@example.com>
Subject: Re: quarterly report
Date: Mon, 3 Mar 2026 14:22:10 +0000
To: bot@example.com
CC: bob@example.com
```

Prepended to `content` so the agent sees it alongside the body.
Attachments passed through the mime pipeline (`processAttachments`)
same as Telegram/WhatsApp.

## Threading

`email_threads` stores both directions:

```sql
CREATE TABLE IF NOT EXISTS email_threads (
  message_id   TEXT PRIMARY KEY,  -- every seen Message-ID
  thread_id    TEXT NOT NULL,     -- derived from root Message-ID
  from_address TEXT NOT NULL,     -- sender email (for outbound reply)
  root_msg_id  TEXT NOT NULL,     -- original Message-ID (for References)
  seen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_thread ON email_threads(thread_id);
```

Outbound `sendMessage(jid, text)`:

1. Extract `thread_id` from jid (`email:<thread_id>`).
2. Query `email_threads WHERE thread_id = ? LIMIT 1` → get
   `from_address` (reply-to) and `root_msg_id` (References header).
3. Send via SMTP with `In-Reply-To: <root_msg_id>` +
   `References: <root_msg_id>`.

## Libraries

- `imapflow` — IMAP + IDLE (Promise-based)
- `nodemailer` — SMTP sending
- `mailparser` — parse raw RFC 2822 messages (addresses, text body)

## Config

```env
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_ACCOUNT=bot@example.com
EMAIL_PASSWORD=app-password
```

Ports hardcoded: IMAP 993 (TLS), SMTP 587 (STARTTLS).

Exported from `config.ts`:

```typescript
export const EMAIL_IMAP_HOST =
  process.env.EMAIL_IMAP_HOST || envConfig.EMAIL_IMAP_HOST || '';
export const EMAIL_SMTP_HOST =
  process.env.EMAIL_SMTP_HOST ||
  envConfig.EMAIL_SMTP_HOST ||
  EMAIL_IMAP_HOST.replace('imap.', 'smtp.');
export const EMAIL_ACCOUNT =
  process.env.EMAIL_ACCOUNT || envConfig.EMAIL_ACCOUNT || '';
export const EMAIL_PASSWORD =
  process.env.EMAIL_PASSWORD || envConfig.EMAIL_PASSWORD || '';
```

Also add `'EMAIL_IMAP_HOST', 'EMAIL_SMTP_HOST', 'EMAIL_ACCOUNT',
'EMAIL_PASSWORD'` to the `readEnvFile()` call.

## DB schema

Added via `database.exec()` in `createSchema()` in `db.ts` (see
Threading section above for full DDL).

## V1 scope

- IMAP IDLE with 60s poll fallback
- Plain text + HTML body (extract as plain text via mailparser)
- Threading via `In-Reply-To` / `References`
- Attachments via mime pipeline
- Single account per instance

## V2 additions

- Gmail API + Pub/Sub for Gmail-specific push (faster reconnect)
- Multi-account
