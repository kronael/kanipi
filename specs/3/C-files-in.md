# File Handling

**Status**: shipped

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

## Shipped

Passive file injection works: attachments are downloaded by the enricher
pipeline and `[media attached: ~/media/...]` lines are prepended to the prompt.
Multi-file messages are supported (one line per attachment). Outbound `send_file`
covered in `specs/1/C-file-output.md`.

## Deferred

- Uniform channel upload support (some channels lack incoming file support)
- Multi-file send (outbound) — agent can only `send_file` one file per action call
