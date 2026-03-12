# Remove Trigger Pattern System

**Status**: shipped

## Problem

The trigger pattern system (`TRIGGER_PATTERN`, auto-prefixing `@${ASSISTANT_NAME}`) is
legacy code from before routing existed. It causes problems:

1. **Auto-prefixing confusion**: When you mention the bot (@mnde_atlas_bot) in Telegram/Discord,
   the code automatically prepends `@marinade` to your message before storing it. This is
   confusing and breaks agent context - the agent sees `@marinade Hey @mnde_atlas_bot...`
   instead of what you actually typed.

2. **Redundant with routing**: All message routing is now handled by the `routes` table
   (command, pattern, default routes). The trigger pattern served the same purpose but
   at a lower level and less flexibly.

3. **Misleading code**: Comments claim this "translates" bot mentions into trigger format,
   but it actually modifies message content in a way that's invisible to users and agents.

## Current Implementation

### config.ts

- Exports `TRIGGER_PATTERN` = `/^@${ASSISTANT_NAME}\b/i`
- Used to detect if message already has trigger prefix

### channels/telegram.ts (lines 79-98)

- Detects `@bot_username` mentions via Telegram entities
- If bot is mentioned AND message doesn't match TRIGGER_PATTERN:
  - Prepends `@${ASSISTANT_NAME}` to content
  - Sets `mentions_me: true`

### channels/discord.ts (lines 88-96)

- Detects `<@bot_id>` mentions
- Strips the mention from content
- If remaining content doesn't match TRIGGER_PATTERN:
  - Prepends `@${ASSISTANT_NAME}` to content

### index.ts

- Uses `TRIGGER_PATTERN` to strip the trigger word from message content before
  passing to routing (lines referencing TRIGGER_PATTERN)

## Solution

**Remove all trigger pattern code.** Routing handles everything now:

1. **Delete auto-prefixing**:
   - Remove `isBotMentioned` detection in telegram.ts
   - Remove `mentionsBot` logic in discord.ts
   - Stop prepending `@${ASSISTANT_NAME}`

2. **Keep bot mention detection for mentions_me flag**:
   - Telegram: still detect @bot_username mentions, set `mentions_me: true`
   - Discord: still detect <@bot_id> mentions, strip them from content, set `mentions_me: true`
   - But DON'T modify message content with auto-prefix

3. **Remove TRIGGER_PATTERN**:
   - Delete from config.ts
   - Remove all imports and usages

4. **Routing is sufficient**:
   - Command routes (`@root`, `@support`) already work
   - Pattern routes (regex matching) already work
   - Default routes handle everything else
   - No need for trigger words at all

## Migration

**No data migration needed.** This is pure code removal.

Existing messages in the database that have auto-prefixed `@marinade` will remain as-is
(historical record). New messages won't get the prefix.

## Files to Change

### Remove TRIGGER_PATTERN export

- `src/config.ts` - delete TRIGGER_PATTERN export (lines 107-110)

### Clean up telegram.ts

- `src/channels/telegram.ts`:
  - Remove TRIGGER_PATTERN import (line 6)
  - Remove auto-prefix logic (lines 79-98):
    - Keep bot mention detection for `mentions_me` flag
    - Delete the `if (!TRIGGER_PATTERN.test(content))` auto-prefix block
  - Result: still set `mentions_me: true` when @bot_username mentioned, but don't modify content

### Clean up discord.ts

- `src/channels/discord.ts`:
  - Remove TRIGGER_PATTERN import (line 13)
  - Keep `<@bot_id>` strip (that's cleaning up Discord's mention format)
  - Remove auto-prefix logic (lines 93-96)
  - Result: strip `<@bot_id>`, set `mentions_me: true`, but don't add `@${ASSISTANT_NAME}`

### Clean up index.ts

- Search for TRIGGER_PATTERN usage
- Remove any trigger stripping logic (if present)
- Routing already handles everything

### Update tests

- `src/formatting.test.ts` - remove any TRIGGER_PATTERN tests
- Update any channel tests that expect auto-prefixed content

## Testing

1. **Telegram**: Mention @bot_username in a group, verify:
   - Message content is stored exactly as typed (no `@marinade` prefix)
   - `mentions_me: true` is set
   - Routing still works correctly

2. **Discord**: Mention <@bot_id>, verify:
   - `<@bot_id>` is stripped from content (Discord-specific cleanup)
   - No `@marinade` added
   - `mentions_me: true` is set
   - Routing still works

3. **Private chats**: Verify messages in private chats (no routing needed) still work

4. **Command routes**: Verify `@root`, `@support` routing still works

## Benefits

- Simpler codebase (delete ~30 lines of confusing logic)
- Messages stored as actually typed
- Agents see real user input, not modified versions
- One routing system instead of two overlapping systems
- Easier to debug (what you type = what's in DB = what agent sees)

## Risks

None. This is pure deletion of redundant code. Routing handles everything the trigger
pattern used to do, but better.
