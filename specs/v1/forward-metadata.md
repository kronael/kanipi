# Forwarded Message Metadata — shipped

## Problem

Telegram (and other channels) carry metadata on forwarded messages:
who originally sent it, from which chat, when. Kanipi drops all of
this — the agent sees raw text with no context that it was forwarded.

Same for reply-to: when a user replies to a specific message, the
agent doesn't see what was being replied to.

## Solution

Store forward/reply metadata in the message DB. Render as nested
XML tags inside `<message>` in the prompt (router.ts).

### Prompt format

```xml
<message sender="Alice" time="...">
  <forwarded_from sender="Bob"/>
  the forwarded text
</message>

<message sender="Alice" time="...">
  <forwarded_from sender="(hidden)"/>
  the forwarded text
</message>

<message sender="Alice" time="...">
  <reply_to sender="Bob">how does SAM work?</reply_to>
  my answer about SAM
</message>
```

Nested tags, not attributes — these will later sit alongside
other context tags like `<user>` (v2 user context):

```xml
<message sender="Alice" time="...">
  <user>Backend dev, works on validator-bonds</user>
  <reply_to sender="Bob">how does SAM work?</reply_to>
  my answer about SAM
</message>
```

The `<message>` tag becomes a container for context + content.

## Schema

Add optional columns to messages table (or fields on NewMessage):

- `forwarded_from` — original sender name (null if not forwarded)
- `reply_to_text` — quoted message preview (null if not a reply)
- `reply_to_sender` — who was being replied to

## Channel extraction

### Telegram

grammy `ctx.message.forward_origin`:

- `type: "user"` → `sender_user.first_name`
- `type: "hidden_user"` → `sender_user_name` or "(hidden)"
- `type: "chat"` → `chat.title`
- `type: "channel"` → `chat.title`

Reply: `ctx.message.reply_to_message.text` (truncate to ~100 chars)

- `reply_to_message.from.first_name`

### WhatsApp

Forward: `contextInfo?.isForwarded` (boolean, no sender info).
Set `forwarded_from` to "(forwarded)".

Reply: `contextInfo?.quotedMessage` + `contextInfo?.participant`

### Discord

No native forwarding. Reply: `message.reference` → fetch referenced
message for preview.

### Email

Forwards visible in subject/body. No extraction needed.
Reply threading handled by In-Reply-To header already.

### Web (Slink)

No forwarding or reply-to concept.

## Implementation

1. Channel adapters: extract metadata, pass to `storeMessage()`
2. DB: add nullable `forwarded_from`, `reply_to_text`, `reply_to_sender`
3. router.ts `formatMessages()`: render as nested XML tags
4. No agent-side changes — it just sees richer XML
