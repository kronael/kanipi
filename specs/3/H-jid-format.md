# JID Format Normalization — spec

Normalize sender JIDs, strip WhatsApp transport suffixes,
add group name to message XML.

## Current state

| Channel  | Chat JID                                  | Sender         |
| -------- | ----------------------------------------- | -------------- |
| WhatsApp | `whatsapp:id@g.us` / `...@s.whatsapp.net` | bare phone     |
| Telegram | `telegram:chatid`                         | bare numeric   |
| Discord  | `discord:channelid`                       | bare snowflake |
| Email    | `email:threadhash`                        | bare address   |
| Web      | `web:folder`                              | `local:<uuid>` |

Problems: WhatsApp leaks transport suffixes, sender has no
platform prefix, group names not in message metadata.

## Target format

```
scheme:id            chat JID (where messages route)
scheme:~id#name      sender JID (who sent the message)
```

**Chat JIDs** (unchanged except WhatsApp cleanup):

```
telegram:-1001234567890        telegram group
telegram:1112184352            telegram DM
whatsapp:120363351541711945    whatsapp group (stripped @g.us)
whatsapp:972501234567          whatsapp DM (stripped @s.whatsapp.net)
discord:1234567890             discord channel
email:a1b2c3d4e5f6             email thread
web:main                       web channel
```

**Sender JIDs** (new — platform-prefixed with display name):

```
telegram:~1112184352#John       telegram user
whatsapp:~972501234567#Mom      whatsapp user
discord:~9876543210#alice       discord user
email:~user@example.com#John   email sender
```

`~` prefix distinguishes sender from chat. `#name` is a cached
display name, updated when the platform reports a change.

**Parsing**: split on `:` → scheme, rest. `~` prefix → sender.
Split on `#` → id, display_name. One function:
`parseJid(jid) → { scheme, id, name?, isSender }`.

## Group name in message XML

Group names go into the `<message>` XML as a `group` attribute:

```xml
<message sender="telegram:~1112184352#John" platform="telegram" group="Support" time="...">
  Hello
</message>
```

Source: `chats.name` column (already in DB). Injected by
`formatMessages()` when the chat is a group (`is_group=1`).

## Migration

### WhatsApp suffix stripping

- `@g.us` → removed
- `@s.whatsapp.net` → removed
- `@lid` → translate to phone first (existing `translateJid`), then strip

### Sender prefix

All channels add `scheme:~` prefix to sender field:

```sql
UPDATE messages SET sender = 'telegram:~' || sender
  WHERE chat_jid LIKE 'telegram:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'whatsapp:~' || sender
  WHERE chat_jid LIKE 'whatsapp:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'discord:~' || sender
  WHERE chat_jid LIKE 'discord:%' AND sender NOT LIKE '%:%';
```

### Code changes

1. WhatsApp: strip `@g.us`/`@s.whatsapp.net` in `bareJid()` and channel constructor
2. All channels: build sender as `scheme:~id#name` in message handlers
3. `formatMessages()`: add `group` attribute from `chats.name`
4. `platformFromJid()`: works as-is (split on `:`)
5. DB migration for existing data
