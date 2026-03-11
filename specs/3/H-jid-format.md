# JID Format Normalization — spec

Strip WhatsApp transport suffixes, add platform prefix to
senders, add group name to message XML.

## Format

All JIDs use `scheme:id`. Same format for chats and senders.

**Chat JIDs** (routing targets):

```
telegram:-1001234567890        telegram group
telegram:1112184352            telegram DM
whatsapp:120363351541711945    whatsapp group
whatsapp:972501234567          whatsapp DM
discord:1234567890             discord channel
email:a1b2c3d4e5f6             email thread
web:main                       web channel
```

**Sender JIDs** (message attribution):

```
telegram:1112184352            telegram user
whatsapp:972501234567          whatsapp user
discord:9876543210             discord user
email:user@example.com         email sender
```

Display names are NOT in the JID. They stay in
`messages.sender_name` (existing column).

## Changes from v1

### WhatsApp suffix stripping

- `@g.us` → removed from chat JIDs
- `@s.whatsapp.net` → removed from chat JIDs
- `@lid` → translate to phone first, then strip

### Sender platform prefix

All senders get `scheme:` prefix. Before: bare `1112184352`.
After: `telegram:1112184352`. Stored in `messages.sender`.

### Message XML attributes

Full metadata on each `<message>` tag:

```xml
<message sender="telegram:1112184352" sender_name="Alice"
         chat="telegram:-1001234567890" group="Support"
         platform="telegram" time="2026-03-11T14:00:00Z">
  Hello
</message>
```

| Attribute     | Source            | Present        |
| ------------- | ----------------- | -------------- |
| `sender`      | messages.sender   | always         |
| `sender_name` | sender_name col   | when available |
| `chat`        | messages.chat_jid | always         |
| `group`       | chats.name        | when is_group  |
| `platform`    | platform          | always         |
| `time`        | timestamp         | always         |

`sender` is the JID (`telegram:1112184352`), not the display
name. Display name is in `sender_name`.

## Migration (0007-jid-format.sql)

```sql
-- Strip WhatsApp suffixes from chat JIDs
UPDATE chats SET jid = REPLACE(jid, '@g.us', '')
  WHERE jid LIKE 'whatsapp:%@g.us';
UPDATE chats SET jid = REPLACE(jid, '@s.whatsapp.net', '')
  WHERE jid LIKE 'whatsapp:%@s.whatsapp.net';

-- Same for messages.chat_jid and routes.jid

-- Strip suffixes from bare senders
UPDATE messages SET sender = REPLACE(sender, '@g.us', '')
  WHERE sender LIKE '%@g.us';
UPDATE messages SET sender = REPLACE(sender, '@s.whatsapp.net', '')
  WHERE sender LIKE '%@s.whatsapp.net';
UPDATE messages SET sender = REPLACE(sender, '@lid', '')
  WHERE sender LIKE '%@lid';

-- Add platform prefix to senders
UPDATE messages SET sender = 'telegram:' || sender
  WHERE chat_jid LIKE 'telegram:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'whatsapp:' || sender
  WHERE chat_jid LIKE 'whatsapp:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'discord:' || sender
  WHERE chat_jid LIKE 'discord:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'email:' || sender
  WHERE chat_jid LIKE 'email:%' AND sender NOT LIKE '%:%';
```

## Code changes

1. WhatsApp: `bareJid()` strips suffixes, `toWaJid()` restores
   them for Baileys using `jidSuffixMap`
2. All channels: sender = `scheme:${platformId}`
3. `formatMessages()`: adds `group` attr from `m.group_name`
4. `platformFromJid()`: unchanged (split on `:`)
5. `sender_name` column: unchanged, carries display name
