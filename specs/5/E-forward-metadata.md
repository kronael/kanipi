---
status: shipped
---

# Forwarded Message Metadata — shipped

## Problem

Channels carry metadata on forwarded and replied-to messages.
Kanipi was dropping all of it — agent saw no context.

## Design

Store forward/reply metadata in the message DB. Render as nested
XML tags inside `<message>` in the prompt.

### Prompt format

```xml
<message sender="Alice" time="...">
  <forwarded_from sender="Bob"/>
  the forwarded text
</message>

<message sender="Alice" time="...">
  <reply_to sender="Bob">how does SAM work?</reply_to>
  my answer about SAM
</message>
```

Nested tags (not attributes) so they compose with other context
tags like `<user>`.

## Schema

Optional columns on messages table:

- `forwarded_from` — original sender name (null if not forwarded)
- `reply_to_text` — quoted message preview (null if not a reply)
- `reply_to_sender` — who was being replied to

## Channel coverage

| Channel  | Forward source                         | Reply source                        |
| -------- | -------------------------------------- | ----------------------------------- |
| Telegram | `forward_origin` (user/hidden/channel) | `reply_to_message` (text + sender)  |
| WhatsApp | `contextInfo?.isForwarded` (no sender) | `contextInfo?.quotedMessage`        |
| Discord  | no native forwarding                   | `message.reference` → fetch preview |
| Email    | visible in subject/body                | `In-Reply-To` threading             |
| Web      | n/a                                    | n/a                                 |
