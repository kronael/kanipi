---
status: in-progress
---

# WebDAV Workspace Access

Expose each group's workspace directory over WebDAV so users can browse,
upload, and manage files directly — same files the agent delivers via
`send_file` in chat.

## Architecture

```
WebDAV client (Cyberduck, rclone, browser)
    ↓ Basic Auth: username:webdav_token
Gateway web-proxy (/dav/<group>/*)
    ↓ validates token (SHA-256 hash in auth_users.webdav_token_hash)
    ↓ checks group ACL (auth_users.webdav_groups JSON array)
    ↓ strips Authorization header, rewrites path to /<group><rest>
dufs (localhost:8179, no auth)
    ↓ serves GROUPS_DIR root
/srv/app/home/groups/<group>/
```

## What's shipped

- `/dav/<group>/*` proxy handler in `web-proxy.ts`
- Auth: Basic `username:webdav_token`, SHA-256 hash check, per-group ACL
- Security: `.env`, `**/*.pem`, `.git/**` writes blocked; `logs/` read-only
- DB: `auth_users.webdav_token_hash`, `auth_users.webdav_groups` (migration 0015)
- Config: `WEBDAV_ENABLED`, `WEBDAV_URL` (default `http://localhost:8179`)

## What's missing

- `dufs` binary in gateway `Dockerfile`
- dufs process start in `kanipi` entrypoint (alongside vite)

## Implementation

### Dockerfile (gateway image)

Add to the final stage, after the existing `curl` + `git` + `docker.io` layer:

```dockerfile
RUN set -e; ARCH=$(dpkg --print-architecture); \
    DUFS_ARCH=$([ "$ARCH" = "amd64" ] && echo "x86_64" || echo "aarch64"); \
    DUFS_VER=$(curl -fsSL https://api.github.com/repos/sigoden/dufs/releases/latest | jq -r .tag_name); \
    curl -fsSL "https://github.com/sigoden/dufs/releases/download/${DUFS_VER}/dufs-${DUFS_VER}-${DUFS_ARCH}-unknown-linux-musl.tar.gz" \
      | tar xz -C /usr/local/bin dufs && chmod +x /usr/local/bin/dufs
```

### kanipi entrypoint

After vite start, before `wait $GATEWAY`:

```bash
# start dufs for WebDAV if enabled
WEBDAV_ENABLED=$(grep -s '^WEBDAV_ENABLED=' "$DATA_DIR/.env" | cut -d= -f2- || true)
if [ "$WEBDAV_ENABLED" = "true" ]; then
  dufs --bind 127.0.0.1 --port 8179 --allow-all "$DATA_DIR/groups" &
  DUFS=$!
  trap 'kill $GATEWAY ${VITE:-} $DUFS 2>/dev/null; wait' INT TERM
fi
```

### .env per instance

```
WEBDAV_ENABLED=true
```

`WEBDAV_URL` defaults to `http://localhost:8179` — no change needed.

## Token management

Tokens set via gateway CLI (existing `auth` commands) or directly:

```bash
# generate token
TOKEN=$(openssl rand -hex 32)
# store hash
sqlite3 $DATA_DIR/store/db.sqlite \
  "UPDATE auth_users SET webdav_token_hash=lower(hex(sha256('$TOKEN'))), webdav_groups='[\"root\"]' WHERE username='alice'"
```

Client URL: `https://<host>/dav/root/` with Basic Auth `alice:<TOKEN>`

## Web UI

dufs ships a built-in file browser UI at the same URL. No separate tool needed.
Navigate to `https://<host>/dav/<group>/` in a browser after auth.
