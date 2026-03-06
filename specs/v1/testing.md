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
pipeline without real platform APIs. Uses testcontainers —
one image, vitest manages lifecycle, no compose file.

**Setup**: testcontainers starts gateway, gateway spawns
mock-agent containers via docker socket.

```typescript
// tests/integration/setup.ts
import { GenericContainer, Wait } from 'testcontainers';

let gateway;

export async function setup() {
  gateway = await new GenericContainer('kanipi:latest')
    .withEnvironment({
      CONTAINER_IMAGE: 'kanipi-mock-agent:latest',
      SLINK_ENABLED: '1',
    })
    .withBindMounts([
      {
        source: '/var/run/docker.sock',
        target: '/var/run/docker.sock',
      },
    ])
    .withExposedPorts(3000)
    .withWaitStrategy(Wait.forHttp('/health', 3000))
    .start();

  process.env.GATEWAY_URL = `http://${gateway.getHost()}:${gateway.getMappedPort(3000)}`;
}

export async function teardown() {
  await gateway?.stop();
}
```

**Mock agent image**: minimal container that reads stdin JSON,
pattern-matches prompt, returns canned responses. Each test
scenario sends a message containing a keyword that triggers
a specific mock behavior.

```bash
#!/bin/sh
# container/mock-agent/entrypoint.sh
read input
prompt=$(echo "$input" | jq -r .prompt)
OUT_START="---NANOCLAW_OUTPUT_START---"
OUT_END="---NANOCLAW_OUTPUT_END---"
IPC="/workspace/ipc/messages"

emit() { echo "$OUT_START"; echo "$1"; echo "$OUT_END"; }

case "$prompt" in
  # --- basic ---
  *echo-test*)
    emit '{"result":"echo ok"}';;

  # --- threading ---
  *reply-test*)
    emit '{"result":"reply to this","replyTo":"msg-123"}';;

  # --- multi-message output (split across chunks) ---
  *long-test*)
    emit '{"result":"line one\nline two\nline three"}';;

  # --- error scenarios ---
  *error-test*)
    emit 'error';;
  *crash-test*)
    exit 1;;
  *timeout-test*)
    sleep 999;;
  *empty-test*)
    emit '{"result":""}';;
  *null-test*)
    emit '{"result":null}';;

  # --- IPC: send message to another JID ---
  *ipc-msg-test*)
    echo '{"type":"message","chatJid":"web/other","text":"cross-group hello"}' \
      > "$IPC/msg-$(date +%s).json"
    emit '{"result":"sent ipc msg"}';;

  # --- IPC: send message to unauthorized JID (non-root) ---
  *ipc-unauth-test*)
    echo '{"type":"message","chatJid":"web/forbidden","text":"should block"}' \
      > "$IPC/unauth-$(date +%s).json"
    emit '{"result":"tried unauth"}';;

  # --- IPC: send file ---
  *ipc-file-test*)
    echo "file content" > /workspace/group/out.txt
    echo '{"type":"file","chatJid":"web/test","filepath":"/workspace/group/out.txt","filename":"out.txt"}' \
      > "$IPC/file-$(date +%s).json"
    emit '{"result":"sent file"}';;

  # --- IPC: send file with path escape attempt ---
  *ipc-file-escape-test*)
    echo '{"type":"file","chatJid":"web/test","filepath":"/etc/passwd","filename":"passwd"}' \
      > "$IPC/escape-$(date +%s).json"
    emit '{"result":"tried escape"}';;

  # --- IPC: reset session ---
  *ipc-reset-test*)
    echo '{"type":"reset_session"}' > "$IPC/reset-$(date +%s).json"
    emit '{"result":"reset requested"}';;

  # --- IPC: schedule task ---
  *ipc-schedule-test*)
    mkdir -p /workspace/ipc/tasks
    echo '{"type":"schedule_task","prompt":"scheduled job","schedule_type":"once","schedule_value":"2099-01-01T00:00:00Z","targetJid":"web/test"}' \
      > /workspace/ipc/tasks/sched-$(date +%s).json
    emit '{"result":"scheduled"}';;

  # --- IPC: pause/resume/cancel task ---
  *ipc-task-pause-test*)
    mkdir -p /workspace/ipc/tasks
    echo '{"type":"pause_task","taskId":"TASK_ID_PLACEHOLDER"}' \
      > /workspace/ipc/tasks/pause-$(date +%s).json
    emit '{"result":"paused"}';;

  # --- IPC: register group (root only) ---
  *ipc-register-test*)
    mkdir -p /workspace/ipc/tasks
    echo '{"type":"register_group","jid":"web/newgroup","name":"New","folder":"newgroup","trigger":"!new"}' \
      > /workspace/ipc/tasks/reg-$(date +%s).json
    emit '{"result":"registered"}';;

  # --- file output: write to group dir ---
  *write-file-test*)
    mkdir -p /workspace/group/output
    echo "agent wrote this" > /workspace/group/output/result.txt
    emit '{"result":"file written"}';;

  # --- share mount: read shared config ---
  *read-share-test*)
    if [ -f /workspace/share/config.txt ]; then
      content=$(cat /workspace/share/config.txt)
      emit "{\"result\":\"share: $content\"}"
    else
      emit '{"result":"share: not found"}'
    fi;;

  # --- share mount: attempt write (should fail for non-root) ---
  *write-share-test*)
    if echo "hack" > /workspace/share/evil.txt 2>/dev/null; then
      emit '{"result":"share: write succeeded"}'
    else
      emit '{"result":"share: write blocked"}'
    fi;;

  # --- session: read previous sessions from system message ---
  *session-check-test*)
    # system messages are prepended to prompt by gateway
    if echo "$prompt" | grep -q "previous_session"; then
      emit '{"result":"has session history"}'
    else
      emit '{"result":"no session history"}'
    fi;;

  # --- system message: check new-day ---
  *day-check-test*)
    if echo "$prompt" | grep -q "new-day"; then
      emit '{"result":"has new-day"}'
    else
      emit '{"result":"no new-day"}'
    fi;;

  # --- enrichment: check if voice annotation present ---
  *voice-check-test*)
    if echo "$prompt" | grep -q "transcription"; then
      emit '{"result":"has transcription"}'
    else
      emit '{"result":"no transcription"}'
    fi;;

  # --- stdin piping: simulate slow read ---
  *stdin-pipe-test*)
    # read additional lines from stdin (group queue pipes new messages)
    while IFS= read -r -t 2 line; do
      : # consume
    done
    emit '{"result":"stdin consumed"}';;

  # --- large output ---
  *large-output-test*)
    big=$(python3 -c "print('x' * 50000)" 2>/dev/null || printf '%0.sx' $(seq 1 50000))
    emit "{\"result\":\"$big\"}";;

  # --- default ---
  *)
    emit '{"result":"ok"}';;
esac
```

Build: `make mock-agent-image`

Each test sends a message containing the keyword (e.g.,
"please echo-test this") and verifies the expected behavior.
The mock agent is deterministic — same keyword, same response.

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

#### Multi-group routing

1. Register two groups with different JIDs
2. POST message to each JID via slink
3. Verify each routed to correct group folder
4. Verify agent prompt contains correct group context

#### IPC file send

1. Send message triggering agent to write file IPC
2. Verify `sendDocument` called with correct path
3. Verify path safety: file must be under GROUPS_DIR

#### IPC auth (non-root blocked)

1. Register root group + child group
2. Child agent writes IPC targeting root's JID
3. Verify blocked with "unauthorized" log
4. Root agent writes IPC targeting child's JID → allowed

#### IPC group registration

1. Root agent writes `register_group` IPC with new JID
2. Verify group appears in registered_groups
3. Non-root agent writes `register_group` → blocked

#### IPC refresh groups

1. Root agent writes `refresh_groups` IPC
2. Verify group metadata synced
3. Non-root → blocked

#### Trigger mode

1. Register group with `requiresTrigger: true`
2. POST message without trigger word → not dispatched
3. POST message with trigger word → dispatched to agent
4. Root group ignores trigger (always dispatches)

#### Container lifecycle

1. Send message → container spawns
2. Wait for idle timeout → container stopped
3. Send another → new container spawns
4. Verify session recorded in DB (start/end/duration)

#### Concurrent containers

1. Send messages to N different groups simultaneously
2. Verify MAX_CONCURRENT_CONTAINERS respected
3. Excess groups queued, not dropped

#### Mime enrichment

1. POST slink message with `media_url` pointing to audio
2. Verify whisper transcription annotation in agent prompt
3. POST with image → verify image annotation

#### IPC task CRUD

1. Agent creates task via IPC → verify in DB
2. Agent pauses task → status changes
3. Agent resumes task → status changes
4. Agent cancels task → deleted from DB
5. Non-root agent can only CRUD own tasks

#### Agent crash (exit code != 0)

1. Send `crash-test` → agent exits 1
2. Verify error notification sent to user
3. Verify session recorded with `result: 'error'`
4. Verify next message spawns fresh container

#### Agent timeout

1. Send `timeout-test` → agent hangs
2. Wait for CONTAINER_TIMEOUT
3. Verify container killed
4. Verify timeout error sent to user
5. Verify session recorded with error

#### Empty / null output

1. Send `empty-test` → agent returns `{"result":""}`
2. Verify no message sent to channel (empty = no response)
3. Send `null-test` → agent returns `{"result":null}`
4. Same — no response sent

#### Large output

1. Send `large-output-test` → agent returns 50KB
2. Verify output truncated at CONTAINER_MAX_OUTPUT_SIZE
3. Verify truncated response still delivered

#### File output from agent

1. Send `write-file-test` → agent writes to group dir
2. Verify file exists on host at `groups/<folder>/output/result.txt`
3. Verify file persists across container restarts

#### IPC file path escape

1. Send `ipc-file-escape-test` → agent tries `/etc/passwd`
2. Verify blocked — file not under GROUPS_DIR
3. No document sent to channel

#### Session recording

1. Send message → container spawns
2. Verify `sessions` table: row with `started_at`, no `ended_at`
3. Agent completes → verify `ended_at`, `result`, `message_count`
4. Send second message → verify `new-session` system message
   contains `<previous_session>` with first session data

#### Session history across restarts

1. Send messages, agent completes (session recorded)
2. Restart gateway container
3. Send new message → verify `new-session` includes previous
   sessions from before restart (DB survives)

#### Group queue ordering

1. POST 3 messages rapidly to same group
2. Verify agent receives all 3 in order in single prompt
3. Verify cursor advances past all 3

#### Group queue isolation

1. POST message to group A and group B simultaneously
2. Verify separate agent containers spawned
3. Each gets only its own group's messages

#### Stdin piping (mid-session messages)

1. Send message, agent spawns (long-running)
2. Send second message while agent running
3. Verify second message piped to agent stdin
4. Agent reads it (`stdin-pipe-test`)

#### Bot message filtering

1. POST message with `is_from_me: true`
2. Verify NOT dispatched to agent (bot's own messages skipped)

#### Message formatting

1. POST message with XML-unsafe chars (`<`, `>`, `&`, `"`)
2. Verify agent prompt has properly escaped XML
3. Response with `<internal>` tags → verify stripped before send

#### Command not found

1. POST `/nonexistent` → verify not intercepted as command
2. Message dispatched to agent as normal text

#### Slink rate limiting

1. POST many messages rapidly from same IP
2. Verify 429 after exceeding SLINK_ANON_RPM
3. With auth token → higher limit (SLINK_AUTH_RPM)

#### Slink auth

1. POST without token to authenticated endpoint → 401
2. POST with valid JWT → 200
3. POST with expired/invalid JWT → 401

#### Chat metadata

1. First message from new JID → verify `chats` table updated
2. Verify chat name stored if available
3. Second message → verify metadata not re-stored unnecessarily

#### Whisper language config

1. Write `.whisper-language` file to group dir (`en`)
2. POST audio message
3. Verify whisper called with `language=en` param

#### SDK hookings (smoke-level, in integration)

These test that the channel SDKs wire correctly into the
gateway's callback system. Uses slink (the only channel
available without real tokens) as the canonical test channel.

1. Slink inbound → `onMessage` fires → DB stores message
2. Slink `onChatMetadata` → DB stores chat metadata
3. Slink outbound → `sendMessage` delivers via SSE
4. Slink `sendDocument` → file delivered via SSE
5. Slink SSE connection → `addSseListener` registered
6. Slink SSE disconnect → `removeSseListener` called

For telegram/discord/whatsapp: unit tests mock the SDK
objects and verify the gateway callbacks fire correctly.
Integration doesn't test real SDK connections — that's smoke.

#### Compaction / diary (future, when implemented)

1. Send many messages → conversation grows
2. Trigger compaction threshold
3. Verify compacted summary written to diary
4. Verify original messages still in DB
5. Verify next agent session gets compacted context

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
