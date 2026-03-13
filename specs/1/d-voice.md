---
status: shipped
---

# Voice Transcription

Voice transcription is no longer a Telegram-only path. The current
implementation is channel-agnostic media enrichment.

## Current flow

```text
channel message
  -> attachment detected
  -> attachment saved under group media dir
  -> MIME handler runs
  -> whisper service HTTP call
  -> transcription lines appended to stored message
  -> prompt re-fetched after enrichment
```

## Implemented handlers

- `src/mime-handlers/voice.ts`
- `src/mime-handlers/video.ts`
- `src/mime-handlers/whisper.ts`

Voice messages can run:

- one auto-detect pass
- optional forced language passes from `.whisper-language`

## Output shape

Transcriptions are appended as annotation lines to the stored message
content before prompt assembly. The agent sees the enriched text in the
normal message history rather than through a separate voice-specific API.

## Config

- `MEDIA_ENABLED`
- `VOICE_TRANSCRIPTION_ENABLED`
- `VIDEO_TRANSCRIPTION_ENABLED`
- `WHISPER_BASE_URL`
- `WHISPER_MODEL`

## Notes

- current implementation is whisper service HTTP, not direct SDK media tools
- current behavior is described more fully in `specs/1/Q-mime.md`
