# Testing Spec — shipped (testability gaps deferred)

Files to create or extend. Use vitest patterns from existing tests.

---

## 1. src/web-proxy.test.ts (new file)

Test `startWebProxy` via a real `http.createServer`. Start the server on a
random port in `beforeAll`, close in `afterAll`. Mock `getGroupBySlink`,
`handleSlinkPost`, `addSseListener`, `removeSseListener`, and the `onMessage`
callback. Use `node:http` or `fetch` to make requests.

Mock setup:

```ts
vi.mock('./db.js', () => ({ getGroupBySlink: vi.fn() }));
vi.mock('./slink.js', () => ({ handleSlinkPost: vi.fn() }));
vi.mock('./channels/web.js', () => ({
  addSseListener: vi.fn(),
  removeSseListener: vi.fn(),
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));
```

Start server helper:

```ts
function startServer(opts?: Partial<Parameters<typeof startWebProxy>[0]>) {
  // pick ephemeral port by passing port 0, capture actual port from
  // server.address() inside startWebProxy — or wrap startWebProxy to return
  // the server. Either refactor startWebProxy to return the server instance,
  // or use net.createServer trick to find a free port first.
  // Simplest: refactor startWebProxy to return http.Server (one-line change).
}
```

### Tests

**GET /pub/sloth.js**

- Input: `GET /pub/sloth.js`
- Expected: status 200, `Content-Type: text/javascript`, body contains `pub/s/`
- Mock: none

**POST /pub/s/:token — known token → 200**

- Input: `POST /pub/s/tok123`, body `{"text":"hi"}`, no auth
- Mock: `getGroupBySlink('tok123')` returns a group object;
  `handleSlinkPost` returns `{ status: 200, body: '{"ok":true}' }`
- Expected: status 200, body `{"ok":true}`

**POST /pub/s/:token — unknown token → 404**

- Input: `POST /pub/s/unknown`, body `{"text":"hi"}`
- Mock: `getGroupBySlink('unknown')` returns `undefined`;
  `handleSlinkPost` returns `{ status: 404, body: '{"error":"not found"}' }`
- Expected: status 404

**POST /pub/s/:token — rate limited → 429**

- Mock: `handleSlinkPost` returns `{ status: 429, body: '{"error":"rate limited"}' }`
- Expected: status 429

**POST /pub/s/:token — valid signed JWT + authSecret → 200**

- Input: `POST /pub/s/tok`, `Authorization: Bearer <valid-hs256-jwt>`, body `{"text":"x"}`
- Mock: `handleSlinkPost` returns `{ status: 200, body: '{"ok":true}' }`
- Assert: `handleSlinkPost` called with `authHeader` containing the Bearer token
  and `authSecret` matching the value passed to `startWebProxy`

**POST /pub/s/:token — invalid JWT + authSecret → 401**

- Mock: `handleSlinkPost` returns `{ status: 401, body: '{"error":"unauthorized"}' }`
- Expected: status 401

**POST /pub/s/:token — x-forwarded-for header used as IP**

- Input: request with `X-Forwarded-For: 203.0.113.5, 10.0.0.1`
- Assert: `handleSlinkPost` called with `ip === '203.0.113.5'`

**POST /pub/s/:token with media_url — attachment fields set**

- Input: body `{"text":"look","media_url":"https://example.com/clip.mp4"}`
- Mock: `handleSlinkPost` returns `{ status: 200, body: '{"ok":true}' }`
- Assert: `handleSlinkPost` called with the correct body string containing `media_url`
  (actual attachment construction is slink.ts's responsibility, already unit-tested)

**GET /\_sloth/stream — registers SSE listener**

- Input: `GET /_sloth/stream?group=mygroup`
- Expected: status 200, `Content-Type: text/event-stream`
- Assert: `addSseListener` called with `'mygroup'`

**POST /\_sloth/message — dispatches to onMessage**

- Input: `POST /_sloth/message`, body `{"group":"main","msg":"hello"}`
- Assert: `onMessage` called with jid `'web:main'`, content includes `'hello'`
- Expected: status 200

**Basic auth — protected route blocked without credentials**

- `startWebProxy` with `slothUsers: 'alice:secret'`
- `GET /` without auth header → 401
- `GET /pub/sloth.js` without auth header → 200 (public prefix bypass)

---

## 2. src/mime-handlers/whisper.test.ts (extend)

Add to existing test file.

**AbortController fires at 30s**

- Use `vi.useFakeTimers()` / `vi.advanceTimersByTimeAsync(30_000)`
- Mock `fetch` to return a promise that never resolves
- After advancing 30s, assert the fetch rejects with abort error
- Cleanup: `vi.useRealTimers()`

```ts
it('aborts fetch after 30s', async () => {
  vi.useFakeTimers();
  let aborted = false;
  global.fetch = vi.fn().mockImplementation((_url, opts) => {
    opts.signal.addEventListener('abort', () => {
      aborted = true;
    });
    return new Promise(() => {}); // never resolves
  });
  const p = whisperTranscribe('/path/audio.ogg');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(aborted).toBe(true);
  vi.useRealTimers();
});
```

---

## 3. src/mime-handlers/video.test.ts (extend)

Add to existing test file.

**ffmpeg timeout kills process at 60s**

- Use `vi.useFakeTimers()`
- Mock spawn to return a process that never emits `close`
- Attach a `kill` spy to the fake process
- After advancing 60s, assert `proc.kill()` was called and handler returns `[]`

```ts
it('kills ffmpeg and returns [] after 60s timeout', async () => {
  vi.useFakeTimers();
  const proc = new EventEmitter() as any;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  mockSpawn.mockReturnValue(proc);
  mockWhisper.mockResolvedValue('irrelevant');

  const p = videoHandler.handle({ mediaType: 'video' }, '/path/0.mp4');
  await vi.advanceTimersByTimeAsync(60_000);
  const lines = await p;
  expect(proc.kill).toHaveBeenCalled();
  expect(lines).toEqual([]);
  vi.useRealTimers();
});
```

---

## 4. src/slink.test.ts (extend)

Add to existing test file.

**media_url sets attachments and download**

- Input: body `{"text":"look","media_url":"https://cdn.example.com/clip.mp4"}`
- Capture args passed to `onMessage`
- Assert fourth arg (download) is a function
- Assert third arg (attachments) has length 1 with `type: 'video'` and
  `source.url === 'https://cdn.example.com/clip.mp4'`

```ts
it('media_url produces video attachment with download fn', () => {
  let captured: Parameters<OnInboundMessage> | null = null;
  const onMessage: OnInboundMessage = (...args) => {
    captured = args;
  };
  handleSlinkPost({
    token: 'tok-media',
    body: '{"text":"look","media_url":"https://cdn.example.com/clip.mp4"}',
    ip: '1.2.3.4',
    group: makeGroup('web:m', 'tok-media'),
    onMessage,
  });
  expect(captured).not.toBeNull();
  const [, , attachments, download] = captured!;
  expect(attachments).toHaveLength(1);
  expect(attachments![0].type).toBe('video');
  expect((attachments![0].source as { url: string }).url).toContain('clip.mp4');
  expect(typeof download).toBe('function');
});
```

**media_url guessType — audio URL → type audio**

- Input: `media_url: "https://cdn.example.com/song.mp3"`
- Assert `attachments![0].type === 'audio'`

**media_url guessType — image URL → type image**

- Input: `media_url: "https://cdn.example.com/photo.jpg"`
- Assert `attachments![0].type === 'image'`

**media_url guessType — unknown extension → type document**

- Input: `media_url: "https://cdn.example.com/file.pdf"`
- Assert `attachments![0].type === 'document'`

**download fn fetches from url**

- After capturing `download`, mock `global.fetch` to return a 200 with
  `arrayBuffer` returning `Buffer.from('bytes')`
- Call `download!(attachments![0], 1_000_000)`
- Assert `fetch` called with the media URL
- Assert returned buffer equals `Buffer.from('bytes')`

**download fn throws when response not ok**

- Mock `fetch` to return `{ ok: false, status: 403 }`
- Assert `download!(...)` rejects with message containing `'HTTP 403'`

**download fn throws when content-length exceeds maxBytes**

- Mock `fetch` to return `{ ok: true, headers: { get: () => '999999' } }`
  where `maxBytes` passed is 100
- Assert rejects with message containing `'too large'`

---

## 5. src/mime-handlers/voice.test.ts (extend)

**voiceHandler does not match video mimeType**

- Assert `voiceHandler.match({ mediaType: 'document', mimeType: 'video/mp4' }) === false`
- Assert `voiceHandler.match({ mediaType: 'video' }) === false`

These two cases confirm voice and video handlers don't overlap.

---

## 6. src/channels/web.test.ts (extend)

**multiple groups are isolated**

- Add listener to `'group-a'` and `'group-b'`
- Send to `'web:group-a'`
- Assert only the `group-a` res received a write; `group-b` res did not

**concurrent writes to same group**

- Add two listeners to the same group (`res1`, `res2`)
- `sendMessage` once
- Assert both received exactly one write with identical payload

---

## 7. Testability gaps — known issues

The codebase uses module-level singletons that make tests fragile without
`vi.mock`. No DI framework is needed, but explicit seams are missing.

### db.ts — module-level singleton

`db` is initialised once at module load. `_initTestDatabase()` exists as
a workaround but tests that import multiple modules sharing `db` can
collide.

**Fix**: export a `setDatabase(d: Database)` helper (one line). Tests call
it in `beforeEach` with a fresh `:memory:` instance. No DI needed.

### config.ts — constants read at import time

`WHISPER_BASE_URL`, `SLINK_ANON_RPM`, etc. are frozen at module load.
Changing them between tests requires `vi.mock()` per file and can't vary
per test case.

**Fix**: export a `_overrideConfig(patch: Partial<Config>)` helper gated
behind `process.env.NODE_ENV === 'test'`. Tests call it in `beforeEach`
and reset in `afterEach`. Keeps production path zero-cost.

### container-runner.ts — docker calls not injectable

`execSync('docker ...')` is called directly. No seam exists for tests.

**Fix**: extract a `runDocker(args: string[]): string` function, export
it, and mock it in tests via `vi.mock('./container-runner.js', ...)`.

### channels — SDK clients constructed in constructor

`TelegramChannel`, `DiscordChannel` etc. instantiate grammy/discord.js in
the constructor. Impossible to test message dispatch without real tokens.

**Fix**: accept an optional `client` parameter in the constructor
(defaults to real SDK). Tests pass a fake. One extra parameter, no
framework.

### Priority order

1. `db.ts` `setDatabase()` — blocks most unit tests
2. `config.ts` `_overrideConfig()` — needed for rate limit / feature flag tests
3. `container-runner.ts` extraction — needed for e2e without docker
4. Channel constructors — lowest priority, integration tests cover these
