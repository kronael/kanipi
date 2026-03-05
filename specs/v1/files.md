# File Access Commands — open (v1)

Bidirectional file transfer between the user and the group workspace,
via gateway-intercepted commands. Modelled on takopi's `/file put` / `/file get`.

See also: `specs/v1/file-output.md` (agent→channel via IPC `send_file`),
`specs/v1/commands.md` (command registry design).

## Scope

Two gateway commands — no agent involvement, no container spawn:

| Command            | Direction        | Effect                           |
| ------------------ | ---------------- | -------------------------------- |
| `/file put [path]` | user → workspace | save uploaded doc into group dir |
| `/file get <path>` | workspace → user | send file from group dir to chat |

The workspace root is `GROUPS_DIR/<group>/` (inside the container:
`/workspace/group/<group>/`). All paths are relative to this root.

## `/file put [path]`

User sends a document with optional caption `/file put <path>`.

- If path is omitted, file is saved to `incoming/<original_filename>`.
- If path ends with `/`, it is treated as a directory prefix.
- `--force` flag: overwrite if file already exists.
- Multi-file: if multiple documents are sent in a media group, all are
  saved; path (if given) must be a directory.

### Flow

1. Gateway intercepts message with document attachment.
2. Verify permissions (see Security below).
3. Parse caption: `parse_file_put(caption)` → `{ rel_path, force }`.
4. Validate `rel_path` (see Path safety).
5. Download file bytes from Telegram.
6. Atomic write: write to tempfile in target dir, then rename.
7. Reply: ``saved `<rel_path>` (<size>)``

### Config

```toml
[files]
enabled = false           # disabled by default
uploads_dir = "incoming"  # default put destination
max_upload_bytes = 20971520   # 20 MB
max_download_bytes = 52428800 # 50 MB
deny_globs = [".git/**", ".env", ".envrc", "**/*.pem"]
allowed_user_ids = []     # empty = admins only in groups, anyone in DM
```

`FILE_TRANSFER_ENABLED=true` in `.env` enables the feature.

## `/file get <path>`

User sends `/file get <rel_path>`.

- If path is a file: send it directly.
- If path is a directory: zip it (excluding `deny_globs`), send as
  `<dirname>.zip`. Abort if zip exceeds `max_download_bytes`.

### Flow

1. Gateway intercepts `/file get` command.
2. Verify permissions.
3. Parse `rel_path`.
4. Validate path safety.
5. If dir: zip with `deny_globs` filter; if file: read bytes.
6. Size check against `max_download_bytes`.
7. Send via channel `sendDocument`.

## Path safety

Shared validation for both commands, mirrors takopi:

```typescript
function normalizeRelPath(value: string): string | null {
  // reject: absolute, ~, .., .git segments, empty
}

function resolveWithinRoot(root: string, rel: string): string | null {
  // reject if resolved path doesn't start with root + '/'
}

function denyReason(rel: string, globs: string[]): string | null {
  // always block .git/**; check deny_globs
}
```

## Security

- **Disabled by default** — `FILE_TRANSFER_ENABLED` must be set.
- `allowed_user_ids`: if set, only those users may transfer files.
- If empty: private chats are open; group chats require admin status.
- Path escape: any path that resolves outside `GROUPS_DIR/<group>/`
  is rejected with `"path escapes workspace root"`.
- Deny globs block sensitive files regardless of permission.
- Upload size enforced before download (via Telegram `file_size` header)
  and again after download.
- Atomic write prevents partial files visible to the agent.

## Implementation notes

- Fits as two handlers in the commands registry (`src/commands/file.ts`).
- Channel capability: `/file get` requires `sendDocument?` — channels
  without it reply with an error message.
- `/file put` requires the message to carry a document attachment;
  caption without attachment → show usage.
- Zip is streamed into a `Buffer` (not a tmp file) for simplicity;
  abort mid-zip on size overflow (`ZipTooLargeError`).
- `write_bytes_atomic`: write to `.kanipi-upload-<random>` in the same
  dir, then `fs.renameSync` — avoids partial reads by the agent.

## Takopi reference

- `src/takopi/telegram/files.py` — path utils, zip, atomic write, deny
- `src/takopi/telegram/commands/file_transfer.py` — put/get handlers,
  permission check, multi-file group upload
- `docs/how-to/file-transfer.md` — user-facing docs
