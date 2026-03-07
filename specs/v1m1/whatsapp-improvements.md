# WhatsApp Channel Improvements

**Status**: open

Research-based improvements for kanipi WhatsApp channel.

## Current State (kanipi v1.0.5)

- Read receipts: `sock.readMessages()` called but errors silently swallowed
- Presence: `sendPresenceUpdate('available')` on connect
- Typing: `sendPresenceUpdate('composing'|'paused')` supported
- No ack reactions
- No configurable behavior

## Issues Identified

### 1. Read Receipts Not Working

**Symptom**: Blue ticks not appearing despite code being correct.

**Likely cause**: Code deployed but service not restarted, OR the
`readMessages()` call is failing silently due to `.catch(() => {})`.

**Fix**: Add logging to track success/failure:

```typescript
this.sock
  .readMessages([msg.key])
  .then(() => logger.debug({ msgId: msg.key.id }, 'Read receipt sent'))
  .catch((err) =>
    logger.warn({ err, msgId: msg.key.id }, 'Read receipt failed'),
  );
```

### 2. Presence Suppresses Phone Notifications

**Problem** ([OpenClaw #30286](https://github.com/openclaw/openclaw/issues/30286)):
When bot connects and sends `sendPresenceUpdate('available')`, WhatsApp
suppresses all push notifications on the linked phone.

**Current code** (whatsapp.ts:143):

```typescript
this.sock.sendPresenceUpdate('available').catch(...)
```

**Fix**: Send `unavailable` after connect to restore phone notifications:

```typescript
// Keep connection active but don't suppress phone notifications
this.sock.sendPresenceUpdate('unavailable').catch((err) => {
  logger.warn({ err }, 'Failed to send unavailable presence');
});
```

**Config option** (future):

```typescript
WHATSAPP_ANNOUNCE_PRESENCE = false; // default: false
```

### 3. Silent Error Handling

**Problem**: Many operations use `.catch(() => {})` which hides failures.

**Affected**:

- `readMessages()` - line 360
- `sendPresenceUpdate()` - line 143, 465
- Group metadata sync - line 163

**Fix**: Replace with logging:

```typescript
.catch((err) => logger.debug({ err }, 'operation failed'))
```

Use `debug` level for non-critical (presence), `warn` for important (receipts).

## New Features to Add

### 4. Voice Message Transcription

OpenClaw transcribes voice messages via Whisper before processing.

**Current kanipi**: Voice messages passed as attachments, transcription
handled by agent (whisper MCP sidecar).

**Improvement**: Gateway-level transcription for:

- Mention detection in voice messages (group trigger)
- Faster processing (don't wait for agent startup)

**Scope**: v2 feature, requires whisper integration in gateway.

### 5. Text Chunking

WhatsApp has ~65K char limit but long messages are hard to read.

**OpenClaw defaults**: 4000 chars, paragraph-aware splitting.

**Implementation**:

```typescript
WHATSAPP_MAX_MESSAGE_LENGTH = 4000;
WHATSAPP_CHUNK_MODE = newline; // length | newline

function chunkMessage(text: string): string[] {
  if (text.length <= maxLength) return [text];
  // Split on paragraph boundaries, fallback to length
}
```

### 6. Group History Injection

When bot is mentioned in group, inject recent unprocessed messages
as context (OpenClaw default: 50 messages).

**Scope**: v2 feature, requires message buffer in gateway.

## Logging

Add trace ID via pino child loggers. Replace silent `.catch(() => {})`
with logged errors. Log levels: debug for presence/receipts, info for
sends, error for failures.

## Configuration Summary

```bash
# .env additions (all optional, sensible defaults)

# Presence
WHATSAPP_ANNOUNCE_PRESENCE=false      # don't suppress phone notifications

# Read receipts
WHATSAPP_READ_RECEIPTS=true           # send blue ticks (default: true)

# Message handling
WHATSAPP_MAX_MESSAGE_LENGTH=4000      # chunk long messages
WHATSAPP_CHUNK_MODE=newline           # length | newline
```

## Implementation Priority

1. **Immediate** (bug fixes):
   - Add logging to read receipts (debug success, warn failure)
   - Fix presence: `unavailable` instead of `available`
   - Ensure typing indicators sent reliably

2. **Short-term** (v1.1):
   - Text chunking for long messages
   - Configurable presence behavior
   - Full trace logging with pino child loggers

3. **Long-term** (v2):
   - Gateway-level voice transcription
   - Group history injection

## Sources

- [OpenClaw WhatsApp Docs](https://docs.openclaw.ai/channels/whatsapp)
- [OpenClaw #30286 - Presence suppresses notifications](https://github.com/openclaw/openclaw/issues/30286)
- [OpenClaw #4448 - Done reaction feature](https://github.com/openclaw/openclaw/issues/4448)
- [OpenClaw #17014 - Audio transcription for mentions](https://github.com/openclaw/openclaw/issues/17014)
- [OpenClaw WhatsApp Integration Guide](https://open-claw.me/channels/whatsapp)
