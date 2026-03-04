# File Output

Agent sending files back to the channel.

## Problem

`sendMessage` accepts only text. Agents can produce files (charts, PDFs,
exports, generated images) but have no way to send them.

## Design

### Agent side

Agent writes output files to `/workspace/media/out/` and includes a
`files` field in the JSON result alongside `result`:

```json
{
  "result": "here's your chart",
  "files": [
    { "path": "out/chart.png", "caption": "monthly spend" },
    { "path": "out/report.pdf" }
  ]
}
```

Paths are relative to `/workspace/media/`. Gateway resolves them to
`groups/<folder>/media/out/<file>` on the host.

### Gateway side

`ContainerOutput` gains an optional `files` field:

```ts
files?: { path: string; caption?: string }[];
```

`container-runner.ts` parses `files` from agent JSON output alongside
`result`. Index passes files to the channel's `sendMessage`.

### Channel side

`sendMessage` signature extends to accept optional files:

```ts
sendMessage(
  jid: string,
  text: string,
  files?: { path: string; caption?: string }[],
): Promise<void>;
```

Each channel sends files using its native API:

- **Telegram**: `bot.api.sendDocument` / `sendPhoto` (detect by extension)
- **Discord**: `message.reply({ files: [...] })`
- **WhatsApp**: `sock.sendMessage` with `document` / `image` payload

Files are sent after the text message (or instead of, if `result` is empty).

## Out dir cleanup

Gateway deletes `groups/<folder>/media/out/` contents after sending,
keeping media dir clean between runs.

## Constraints

- Max file size per channel: Telegram 50MB, Discord 25MB, WhatsApp 100MB
- Agent must not write outside `/workspace/media/out/` for output files
- `files` field is ignored if path traversal detected (`..` in path)
