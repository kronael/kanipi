# WhatsApp Channel Improvements

**Status**: shipped

## Changes

- **Presence**: Set to `unavailable` on connect (prevents bot from
  suppressing phone notifications via WhatsApp Web).
- **Read receipts**: Log failures instead of silently swallowing them.

## Deferred to v2

- Voice transcription for mention detection
- Group history injection on mention
- Text chunking (agent responsibility)
