# File Output — shipped

Agent sending files back to the channel.

## Design

Uses the same IPC pattern as `send_message`. Agent calls the `send_file`
MCP tool mid-run; gateway delivers the file immediately without waiting for
the agent to finish.

### Agent side

Call `send_file` with an absolute path inside the workspace:

```
send_file(filepath="/home/node/media/20260304/report.csv")
send_file(filepath="/home/node/media/20260304/chart.png", filename="Monthly Spend")
```

Store files you want to keep under `/home/node/media/YYYYMMDD/`.
All file types are supported. Files are not cleaned up by the gateway —
agent manages its own workspace.

### Gateway side

Agent calls the `send_file` MCP action via request-response IPC.
Gateway translates `~/...` paths from the container to host `GROUPS_DIR/<group>/...`.
Paths that escape `GROUPS_DIR` are blocked with an error reply.

`Channel` interface has an optional `sendDocument?` method. Channels that
don't implement it log a warning and skip silently.

### Channel support

- **Telegram**: `sendDocument` via `InputFile` — implemented
- **Discord**: `sendDocument` via `AttachmentBuilder` — implemented
- **WhatsApp**: `sendDocument` via baileys document message — implemented
- **Email**: not applicable (email channel is inbound-only)

## Why not result-based (original spec)

The original design appended `files[]` to the agent's final JSON result.
Rejected because:

- Files only sent post-run, inconsistent with `send_message` mid-run delivery
- Pollutes `sendMessage` signature across all channels
- Requires a dedicated `/workspace/media/out/` dir and gateway cleanup logic
