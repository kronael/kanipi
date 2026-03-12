# WhatsApp Channel Improvements

**Status**: shipped

## What Was Done

### Presence: Unavailable on Connect

Changed `sendPresenceUpdate('available')` to `sendPresenceUpdate('unavailable')`
on connect. This prevents the bot from suppressing phone notifications when
connected via WhatsApp Web.

### Read Receipts: Logged Failures

Replaced silent `.catch(() => {})` with logged errors on `readMessages()`:

```typescript
this.sock.readMessages([msg.key]).catch((err) => {
  logger.debug({ err, msgId: msg.key.id }, 'read receipt failed');
});
```

## Deferred to v2

- **Voice transcription**: Gateway-level whisper for mention detection
- **Group history injection**: Inject recent messages as context on mention
- **Text chunking**: Agent responsibility, not gateway
