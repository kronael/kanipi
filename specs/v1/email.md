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
- `connect()` — open IMAP connection, start IDLE loop
- `disconnect()` — close IMAP + SMTP connections
- `sendMessage(jid, text)` — SMTP reply in thread

## Source and sink

- **Inbound**: IMAP IDLE (push). Server notifies on new mail; client
  issues `FETCH` immediately. Falls back to 60s polling if IDLE
  unsupported (rare).
- **Outbound**: SMTP reply via `In-Reply-To` + `References` headers.
- Single account per instance.

## IMAP IDLE

`imapflow` exposes `.idle()` which sends the IDLE command and resolves
when the server sends `EXISTS` or `EXPUNGE`. Loop:

```typescript
while (connected) {
  await client.idle(); // blocks until server pushes
  await fetchUnseen();
}
```

On `idle()` error (network drop, timeout), reconnect with exponential
backoff (1s, 2s, 4s… cap 60s).

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

Cross-channel linking (e.g. same person on Telegram + email) handled
in v2 — see `specs/v2/identities.md`.

## Threading

Store `message_id → thread_id` in SQLite on every inbound message.
Outbound reply sets `In-Reply-To` + `References` to maintain thread.

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

```sql
CREATE TABLE IF NOT EXISTS email_threads (
  message_id TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL,
  seen_at    TEXT NOT NULL
);
```

Added via `database.exec()` in `createSchema()` in `db.ts`.

## V1 scope

- IMAP IDLE with 60s poll fallback
- Plain text + HTML body (extract as plain text via mailparser)
- Threading via `In-Reply-To` / `References`
- No attachment handling
- Single account per instance

## V2 additions

- Gmail API + Pub/Sub for Gmail-specific push (faster reconnect)
- Attachment support
- Multi-account
