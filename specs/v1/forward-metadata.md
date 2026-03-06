# Forwarded Message Metadata

## Problem

Telegram (and other channels) carry metadata on forwarded messages:
who originally sent it, from which chat, when. Kanipi drops all of
this — the agent sees raw text with no context that it was forwarded.

## Solution

Parse forward metadata in each channel adapter. Prepend a metadata
line to the message text, same pattern as media placeholders.

## Format

```
[Forwarded from <name>] <original text>
[Forwarded from <name>, <date>] <original text>
```

If the forward origin is hidden (privacy settings):

```
[Forwarded message] <text>
```

## Channels

### Telegram

grammy `ctx.message.forward_origin` object:

- `type: "user"` → `forward_origin.sender_user.first_name`
- `type: "hidden_user"` → `forward_origin.sender_user_name`
- `type: "chat"` → `forward_origin.chat.title`
- `type: "channel"` → `forward_origin.chat.title`

Also: `forward_origin.date` (unix timestamp).

### WhatsApp

Baileys: `message.message?.extendedTextMessage?.contextInfo?.isForwarded`
and `contextInfo.forwardingScore`. No original sender info exposed.

```
[Forwarded message] <text>
```

### Discord

Discord doesn't have native forwarding. Users quote or embed.
No change needed.

### Email

Email forwards have `Fwd:` subject prefix and quoted body.
Already visible in text — no metadata extraction needed.

### Web (Slink)

No forwarding concept. No change needed.

## Reply-to context

Separate but related: messages that are replies carry `reply_to_message_id`.
This should also be preserved as metadata:

```
[Reply to <sender>: "<preview>"] <text>
```

Telegram: `ctx.message.reply_to_message`
WhatsApp: `contextInfo.quotedMessage` + `contextInfo.participant`

## Implementation

In each channel's message handler, before passing text to the gateway:

1. Check for forward metadata
2. Check for reply-to metadata
3. Prepend metadata lines to message text
4. Gateway and agent see enriched text — no schema changes needed
