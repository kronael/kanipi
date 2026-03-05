# JID Hierarchy — v3

Migrate flat JIDs (`discord:channelid`, `tg:-100123456`) to hierarchical
path JIDs with `/` separator and glob-based routing.

## Target format

```
discord/serverid/channelid/threadid
tg/chatid/threadid
wa/groupjid/threadid
email/domain/threadid
```

## Glob routing

Registered groups use glob patterns instead of exact JIDs:

```
discord/*/general/*   — all threads in any #general
tg/*/                 — all telegram chats
discord/serverid/**   — everything in a server
```

`ownsJid()` becomes a glob match instead of prefix check.

## Why deferred

Requires abstracting all channel JID construction and matching before
migrating. Touches: `chat_jid` in `messages`, `chats`, `registered_groups`,
`email_threads` — mechanical but broad. All channel impls need updating.
Needs a channel abstraction layer that owns JID construction so the migration
is in one place, not spread across four channel files.

## v1 workaround

Discord thread channels accidentally work with flat JIDs — each thread has
its own Discord channel ID, so it gets a unique `discord:<threadChannelId>`
JID. Parent channel context is available at runtime via `channel.parentId`
but not encoded in the JID. Telegram forum topics are the main gap — they
share a `chat_id` and need `message_thread_id` to distinguish rooms, which
flat JIDs cannot represent. Deferred.
