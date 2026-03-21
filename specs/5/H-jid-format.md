---
status: shipped
---

# JID Format Normalization — spec (shipped)

Add platform prefix to senders, enrich message XML attributes,
add clock header. Keep WhatsApp suffixes (no collisions).

## Format

All JIDs use `scheme:id`. Same format for chats and senders.

**Chat JIDs** (routing targets):

```
telegram:-1001234567890                    telegram group
telegram:1112184352                        telegram DM
whatsapp:120363351541711945@g.us           whatsapp group
whatsapp:972501234567@s.whatsapp.net       whatsapp DM
discord:1234567890                         discord channel
email:a1b2c3d4e5f6                         email thread
web:main                                   web channel
```

**Sender JIDs** (message attribution):

```
telegram:1112184352                        telegram user
whatsapp:972501234567@s.whatsapp.net       whatsapp user
discord:9876543210                         discord user
email:user@example.com                     email sender
```

Display names are NOT in the JID. They stay in
`messages.sender_name` (existing column).

## Changes from v1

### WhatsApp suffixes

Keep suffixes as-is (`@g.us`, `@s.whatsapp.net`). Stripping could cause
collisions between group IDs and user IDs. The suffixes are ugly but safe.

### Sender platform prefix

All senders get `scheme:` prefix. Before: bare `1112184352`.
After: `telegram:1112184352`. Stored in `messages.sender`.

### Clock header

Injected once per agent invocation, before all messages:

```xml
<clock time="2026-03-11T17:23:00.000Z" tz="Europe/Prague" />
```

| Attribute | Source             | Present |
| --------- | ------------------ | ------- |
| `time`    | `new Date()` (UTC) | always  |
| `tz`      | `TIMEZONE` env var | always  |

Injection point: `index.ts` prompt assembly, prepended before
system messages and `<messages>`. Not injected on piped
messages (only the initial prompt gets the clock).

### Message XML attributes

Full metadata on each `<message>` tag:

```xml
<message sender="Alice" sender_id="telegram:1112184352"
         chat_id="telegram:-1001234567890" chat="Support"
         platform="telegram" time="2026-03-11T14:00:00Z" ago="3h">
  Hello
</message>
```

| Attribute   | Source             | Present                          |
| ----------- | ------------------ | -------------------------------- |
| `sender`    | sender_name col    | always (falls back to sender ID) |
| `sender_id` | messages.sender    | always                           |
| `chat_id`   | messages.chat_jid  | always                           |
| `chat`      | chats.name         | when is_group                    |
| `platform`  | platform           | always                           |
| `time`      | timestamp          | always                           |
| `ago`       | computed at format | always                           |

`sender` = display name, `sender_id` = JID. `chat` = chat
group name (message origin, not agent run group), `chat_id` = JID.
`ago` = human-readable relative time (e.g. `3h`, `2d`, `1w`).

## Session context injection

**Status: shipped** — context is delivered via env vars in
`settings.json` (NANOCLAW_GROUP_FOLDER, NANOCLAW_CHAT_JID,
NANOCLAW_CHANNEL_NAME, NANOCLAW_GROUP_NAME, NANOCLAW_TIER, etc.)
rather than XML `<context>` block injection. The agent reads
these from `settings.json` at startup. The XML injection approach
described below was the original design but env vars proved simpler.

The original design proposed prepending a `<context>` block
before `<messages>`:

```xml
<context>
  <agent group="atlas/support" name="Atlas Support" tier="2" world="atlas"/>
  <chat jid="telegram:-1001234567890" name="Support" platform="telegram" is_group="true"/>
</context>
<messages>
  ...
</messages>
```

### `<agent>` attributes

| Attribute | Source                | Present |
| --------- | --------------------- | ------- |
| `group`   | NANOCLAW_GROUP_FOLDER | always  |
| `name`    | NANOCLAW_GROUP_NAME   | always  |
| `tier`    | NANOCLAW_TIER         | always  |
| `world`   | folder.split('/')[0]  | always  |

### `<chat>` attributes

| Attribute  | Source               | Present        |
| ---------- | -------------------- | -------------- |
| `jid`      | NANOCLAW_CHAT_JID    | always         |
| `name`     | chats.name           | when available |
| `platform` | platformFromJid(jid) | always         |
| `is_group` | chats.is_group       | always         |

### Implementation

`container-runner.ts` writes env vars to `settings.json` before
each agent invocation. The agent reads them via the SDK's settings
mechanism. No XML prompt injection needed.

## Migration

SQL migration adds platform prefix to existing sender values in the
messages table, matching by `chat_jid` prefix. WhatsApp suffixes kept as-is.
