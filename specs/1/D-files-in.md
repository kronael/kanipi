# File Handling

**Status**: partial

Two separate shipped pieces exist today:

- outbound file sending via `send_file`
- command-driven user file transfer via `/file put|get|list`

## Current user flow

### Upload into workspace

User sends an attachment, then uses:

```text
/file put [path]
```

The gateway stores the attachment under the group workspace and confirms
the saved path.

### Download from workspace

```text
/file get <path>
```

Gateway resolves the path inside the group folder, applies deny-glob and
size checks, then sends the file back through the channel.

### List files

```text
/file list [path]
```

Lists workspace contents under the resolved directory.

## Outbound from agent

Agent uses the `send_file` action with an absolute path under
`/workspace/group/...`.

That part is covered in `specs/1/C-file-output.md`.

## Open

- richer passive file injection into normal prompts
- multi-file flows
- more uniform channel support for uploads
