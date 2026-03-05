# JID Hierarchy

JIDs use `:` as separator. Hierarchical channels (Discord servers/threads,
Telegram forum topics) construct multi-segment JIDs. Routing supports glob
patterns so a registered group can match a range of JIDs.

## Format

```
discord:serverid:channelid:threadid
tg:chatid:threadid
wa:groupjid:threadid
email:domain:threadid
```

Existing flat JIDs (`discord:channelid`, `tg:-100123456`) remain valid —
they are the first two segments. No migration needed for channels that don't
use sub-hierarchy.

## Glob routing

`registered_groups.chat_jid` may be a glob pattern:

```
discord:serverid:channelid:*   — all threads under a channel
discord:serverid:*             — all channels in a server
tg:-100123456:*                — all forum topics in a group
```

`ownsJid()` and group lookup become glob matches. A message on
`discord:serverid:channelid:threadid` matches a group registered as
`discord:serverid:channelid:*`. Most specific match wins.

## Channel responsibility

Each channel decides how to construct its JIDs. Gateway only sees the
string and matches against registered groups via glob.

- **Discord** — `discord:<serverId>:<channelId>` for channels;
  `discord:<serverId>:<channelId>:<threadId>` for threads.
  `msg.channel.parentId` available to construct parent segment.
- **Telegram** — `tg:<chatId>` for plain chats;
  `tg:<chatId>:<messageThreadId>` for forum topics.
- **WhatsApp**, **email** — flat for now; extend when needed.

## Implementation

- `ownsJid()` per channel: match own prefix only (`discord:*`, `tg:*`)
- Group lookup in gateway: glob match `registered_groups.chat_jid` against
  inbound JID — use `minimatch` or similar
- DB: `chat_jid` columns are plain strings, no schema change
- Channels construct multi-segment JIDs where hierarchy exists

## Reply vs reference rule

- **Within the same JID (leaf)** — use native reply (`replyTo`). Message and
  reply are in the same room. Channel renders as a reply bubble/thread.
- **Across JIDs** — use a reference link (URL or channel-native deep link).
  Replying across rooms is not possible natively; the agent includes a link
  to the original message instead.

This applies at all levels: replying within a Discord thread uses `replyTo`;
referencing a message from a different thread or channel uses a link.

## Open

- Add glob matching to group lookup (`src/index.ts` / `src/db.ts`)
- Discord: emit `discord:serverid:channelid:threadid` on inbound threads
- Telegram: emit `tg:chatid:threadid` for forum topics
- Document JID format in agent SKILL.md
