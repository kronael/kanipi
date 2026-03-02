# Email channel (v1)

IMAP inbound + SMTP outbound. Generic mail provider support.
Gmail Pub/Sub push as optional fast path (v2).

## Source and sink

- **Inbound**: poll IMAP INBOX, process unseen messages, mark read
- **Outbound**: SMTP reply in same thread via `In-Reply-To` / `References` headers
- Enabled by: `EMAIL_IMAP_HOST` + `EMAIL_ACCOUNT` + `EMAIL_PASSWORD` in .env

## JID format

`email:{thread_id}` where `thread_id` = hash of root `Message-ID` header.

New thread (no `In-Reply-To` match) → generate thread_id from root Message-ID.
Existing thread → look up thread_id in DB via `In-Reply-To` → use as chat_jid.

## Threading

Store `message_id → thread_id` in SQLite on every inbound message.
Outbound reply sets `In-Reply-To` + `References` headers to maintain thread.
Subject line used as sender context in message metadata.

## Libraries

- `imapflow` — IMAP polling (modern, Promise-based, well-maintained)
- `nodemailer` — SMTP sending

## Config

```env
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_IMAP_PORT=993
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_ACCOUNT=bot@example.com
EMAIL_PASSWORD=app-password
EMAIL_POLL_INTERVAL_MS=30000
```

## DB schema additions

```sql
CREATE TABLE email_threads (
  message_id TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL,
  seen_at    TEXT NOT NULL
);
```

## V1 scope

- IMAP polling only (no Pub/Sub)
- Plain text + HTML emails (content extracted as plain text)
- Threading via `In-Reply-To` / `References`
- No attachment handling
- Single account per instance

## V2 additions

- Gmail API + Google Cloud Pub/Sub for push delivery (~0ms latency)
- Attachment support (images, PDFs passed to agent)
- Multi-account support
