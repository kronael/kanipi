# Remove Trigger Pattern System

**Status**: shipped

## Problem

The trigger pattern system (`TRIGGER_PATTERN`, auto-prefixing
`@${ASSISTANT_NAME}`) was legacy code from before routing existed. It:

1. Modified stored message content invisibly (agent saw `@marinade Hey...`)
2. Was redundant with the `routes` table (command, pattern, default routes)
3. Had misleading "translation" comments that masked content mutation

## Decision

Remove all trigger pattern code. Routing handles everything now.

- Deleted `TRIGGER_PATTERN` from config and all imports/usages
- Kept bot mention detection for `mentions_me` flag (Telegram, Discord)
- Channels no longer prepend `@${ASSISTANT_NAME}` to content
- Discord still strips `<@bot_id>` (platform-specific cleanup)
- No data migration needed — historical auto-prefixed messages remain as-is
- Pure code deletion, no new behavior
