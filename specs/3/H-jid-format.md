# JID Format Normalization — spec

Compact URI format for all JIDs. Shorten prefixes, strip
platform suffixes, add sender identity via fragment.

## Current state

| Channel  | Chat JID format                           | Sender format  |
| -------- | ----------------------------------------- | -------------- |
| WhatsApp | `whatsapp:id@g.us` / `...@s.whatsapp.net` | bare phone     |
| Telegram | `telegram:chatid`                         | bare numeric   |
| Discord  | `discord:channelid`                       | bare snowflake |
| Email    | `email:threadhash`                        | bare address   |
| Web      | `web:folder`                              | `local:<uuid>` |

Problems: verbose prefixes, WhatsApp leaks transport suffixes,
sender has no platform prefix, group names not in message metadata.

## Target format

```
scheme:id            chat JID (where messages route)
scheme:~id#name      sender JID (who sent the message)
```

**Chat JIDs** (routing targets):

```
tg:-1001234567890           telegram group
tg:1112184352               telegram DM
wa:120363351541711945        whatsapp group (stripped @g.us)
wa:972501234567              whatsapp DM (stripped @s.whatsapp.net)
dc:1234567890                discord channel
em:a1b2c3d4e5f6              email thread
web:main                     web channel
```

No fragment on chat JIDs. Group name is metadata, injected via
XML attributes (see below).

**Sender JIDs** (message attribution):

```
tg:~1112184352#John          telegram user
wa:~972501234567#Mom         whatsapp user
dc:~9876543210#alice         discord user
em:~user@example.com#John   email sender
```

`~` prefix distinguishes sender from chat. `#name` is a cached
display name, updated when the platform reports a change.

**Parsing**: split on `:` → scheme, rest. `~` prefix → sender.
Split on `#` → id, display_name. One function:
`parseJid(jid) → { scheme, id, name?, isSender }`.

## Group name in message XML

Group names go into the `<message>` XML as a `group` attribute,
alongside existing `platform` and `sender`:

```xml
<message sender="tg:~1112184352#John" platform="tg" group="Support" time="...">
  Hello
</message>
```

Source: `chats.name` column (already in DB). Injected by
`formatMessages()` when the chat is a group (`is_group=1`).

## Migration

Prefix mapping:

| Old         | New    |
| ----------- | ------ |
| `whatsapp:` | `wa:`  |
| `telegram:` | `tg:`  |
| `discord:`  | `dc:`  |
| `email:`    | `em:`  |
| `web:`      | `web:` |

WhatsApp suffix stripping: `@g.us` → removed,
`@s.whatsapp.net` → removed, `@lid` → translate first then strip.

DB migration updates `chats.jid`, `messages.chat_jid`,
`messages.sender` (add `~` prefix), `routes.jid`.

Code changes: `platformFromJid()` (works as-is, shorter prefixes),
`ownsJid()` per channel, `bareJid()` simplification, channel
constructors emit new format, `formatMessages()` adds group attr.
