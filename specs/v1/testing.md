# Testing

## Test tiers

```
make test         unit tests, mocked, <5s
make integration  full gateway + mock agent in docker, ~30s
make smoke        real instance, real API calls (SDK wiring only)
```

### Unit (`make test`)

Vitest, mocked deps, no docker, no network. Covers:

- Message formatting, XML generation
- DB operations (in-memory SQLite)
- IPC auth, command dispatch
- Router glob matching
- Config parsing, folder validation

### Integration (`make integration`)

Full gateway in docker with mock agent. Tests the complete
pipeline without real platform APIs.

**Setup**: `docker compose -f docker-compose.test.yml up`

```yaml
# docker-compose.test.yml
services:
  gateway:
    image: kanipi:latest
    environment:
      CONTAINER_IMAGE: kanipi-mock-agent:latest
      SLINK_ENABLED: '1'
      # no TELEGRAM_BOT_TOKEN, DISCORD_BOT_TOKEN etc.
    volumes:
      - ./tmp/test-data:/srv/data/kanipi_test
    ports:
      - '0:3000' # slink HTTP


  # gateway spawns mock-agent containers via docker socket
```

**Mock agent image**: minimal container that reads stdin JSON,
pattern-matches prompt, returns canned output.

```bash
#!/bin/sh
# container/mock-agent/entrypoint.sh
read input
prompt=$(echo "$input" | jq -r .prompt)
cat <<EOF
---NANOCLAW_OUTPUT_START---
EOF
case "$prompt" in
  *reply-test*)
    echo '{"result":"reply to this","replyTo":"msg-123"}';;
  *error-test*)
    echo 'error';;
  *ipc-test*)
    # write IPC message, then respond
    echo '{"type":"message","chatJid":"web/test","text":"from agent"}' \
      > /workspace/ipc/messages/out.json
    echo '{"result":"sent ipc"}';;
  *)
    echo '{"result":"ok"}';;
esac
cat <<EOF
---NANOCLAW_OUTPUT_END---
EOF
```

Build: `make mock-agent-image`

**Test runner**: vitest (or standalone script) that:

1. Starts gateway via docker compose
2. Waits for slink HTTP to be ready
3. Runs scenarios via HTTP + DB queries
4. Tears down

```typescript
// tests/integration/setup.ts
import { execSync } from 'child_process';

export async function setup() {
  execSync('docker compose -f docker-compose.test.yml up -d');
  await waitForHttp('http://localhost:3000/health');
}

export async function teardown() {
  execSync('docker compose -f docker-compose.test.yml down -v');
}
```

**Scenarios**:

#### Message round-trip

1. POST message via slink
2. Wait for agent response
3. Verify response delivered back via slink SSE
4. Query DB: message stored, cursor advanced

#### Threading (inbound + outbound)

1. POST message A via slink
2. POST message B with `replyTo: A.id`
3. Verify agent prompt contains `<in_reply_to>`
4. Verify agent response carries replyTo back

#### System messages

1. First message to a group → verify `new-session` injected
2. Advance clock past midnight → verify `new-day` injected

#### Commands

1. POST `/new` via slink → verify session cleared, response sent
2. POST `/ping` → verify bot name in response
3. POST `/chatid` → verify JID in response

#### Error retry

1. Send message that triggers `error-test` prompt pattern
2. Verify error notification sent to user
3. Verify cursor rolled back (message re-queued)

#### IPC message send

1. Send message triggering `ipc-test` pattern
2. Verify agent's IPC message delivered to target JID

#### IPC reset_session

1. Write `{"type":"reset_session"}` to IPC dir
2. Send SIGUSR1 to gateway
3. Verify session cleared

#### Task scheduling

1. Agent writes schedule_task IPC
2. Verify task created in DB
3. Fast-forward time → verify task executes

#### Glob routing

1. Register group with glob JID `web/*`
2. POST message to `web/anything`
3. Verify routed to the glob group

#### Share mount

1. Write file to `groups/<world>/share/test.txt`
2. Verify mock agent can read `/workspace/share/test.txt`
3. Verify non-root agent gets it read-only

### Smoke (`make smoke`)

Runs against a real instance. Tests only SDK wiring —
can the bot actually connect and send?

```bash
# smoke/telegram.sh
TOKEN=$TELEGRAM_BOT_TOKEN
CHAT=$TELEGRAM_TEST_CHAT
curl -s "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d chat_id=$CHAT -d text="smoke $(date +%s)" \
  | jq -e '.ok == true'

# smoke/discord.sh  — similar via Discord REST API
# smoke/slink.sh    — POST to real slink endpoint
```

Smoke tests are optional, manual, not in CI. They verify
the SDKs actually work with real credentials. No agent
involvement — just send a message, check it arrives.

---

## Existing unit test specs

### web-proxy.test.ts

Test `startWebProxy` via real `http.createServer` on random
port. Mock `getGroupBySlink`, `handleSlinkPost`,
`addSseListener`, `removeSseListener`.

Tests:

- GET /pub/sloth.js → 200, javascript
- POST /pub/s/:token known → 200
- POST /pub/s/:token unknown → 404
- POST /pub/s/:token rate limited → 429
- POST /pub/s/:token valid JWT → 200
- POST /pub/s/:token invalid JWT → 401
- X-Forwarded-For used as IP
- POST with media_url → attachment fields
- GET /\_sloth/stream → SSE listener registered
- POST /\_sloth/message → onMessage dispatched
- Basic auth blocks protected routes, allows /pub/

### whisper.test.ts (extend)

- AbortController fires at 30s (fake timers)

### video.test.ts (extend)

- ffmpeg timeout kills process at 60s (fake timers)

### slink.test.ts (extend)

- media_url → video/audio/image/document attachment
- download fn fetches, rejects on !ok, rejects on too large

### voice.test.ts (extend)

- voiceHandler does not match video mimeType

### web.test.ts (extend)

- Multiple groups isolated
- Concurrent writes to same group

---

## Testability seams (shipped)

- `db.ts`: `setDatabase()` for in-memory SQLite
- `config.ts`: `_overrideConfig()` / `_resetConfig()` (test only)
- `container-runner.ts`: `_spawnProcess` injectable spawn
- Channels: constructor injection deferred, integration tests cover
