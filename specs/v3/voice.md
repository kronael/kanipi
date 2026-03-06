# Voice Transcription — shipped

Telegram voice messages transcribed via Whisper before entering the agent pipeline.

## Detection

`msg.voice` or `msg.audio` on incoming grammy update. Currently stored as
`[Voice message]` / `[Audio]` placeholders — v2 replaces this with actual
transcription.

## Download

grammy file API → OGG buffer in memory (no temp files).

## Transcription

POST `multipart/form-data` to `${WHISPER_BASE_URL}/v1/audio/transcriptions`:

| Field   | Value                                  |
| ------- | -------------------------------------- |
| `file`  | OGG buffer, filename `voice.ogg`       |
| `model` | `WHISPER_MODEL` (default: `whisper-1`) |

Config:

- `WHISPER_BASE_URL` — e.g. `https://api.openai.com` or local server
- `WHISPER_API_KEY` — passed as `Authorization: Bearer` (optional)
- `WHISPER_MODEL` — default `whisper-1`

If `WHISPER_BASE_URL` is unset: reply `"voice not configured"` and return.
HTTP errors or empty transcript: reply `"voice transcription failed"` and return.

## Injection

Transcribed text prefixed with `[voice] ` replaces the message body and
enters the existing pipeline unchanged:

```
store message → group queue → runContainerAgent
```

OGG is the native Telegram format; no re-encoding needed for Whisper.
