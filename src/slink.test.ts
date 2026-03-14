import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  _setTestGroupRoute,
  getGroupBySlink,
  GroupConfig,
} from './db.js';
import {
  _resetRateLimitBuckets,
  generateSlinkToken,
  handleSlinkPost,
} from './slink.js';
import type { InboundEvent, OnInboundMessage } from './types.js';

import crypto from 'crypto';

// JWT helper: create a minimal unsigned JWT with the given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from('{"alg":"none"}').toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

// JWT helper: create a properly HS256-signed JWT
function makeSignedJwt(
  payload: Record<string, unknown>,
  secret: string,
): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function makeGroup(jid: string, token: string): GroupConfig & { jid: string } {
  return {
    jid,
    name: jid,
    folder: jid.replace(':', '-'),
    added_at: new Date().toISOString(),
    slinkToken: token,
  };
}

function collect(): { messages: InboundEvent[]; onMessage: OnInboundMessage } {
  const messages: InboundEvent[] = [];
  return { messages, onMessage: (_jid, msg) => messages.push(msg) };
}

beforeEach(() => {
  _resetRateLimitBuckets();
  _initTestDatabase();
});

// --- token not found ---

describe('token not found', () => {
  it('returns 404 when group is undefined', () => {
    const { onMessage } = collect();
    const r = handleSlinkPost({
      token: 'doesnotexist',
      body: '{"text":"hi"}',
      ip: '1.2.3.4',
      group: undefined,
      onMessage,
    });
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'not found' });
  });
});

// --- valid token returns 200 ---

describe('valid token', () => {
  it('returns 200 and delivers message', () => {
    const { messages, onMessage } = collect();
    const group = makeGroup('web:main', 'tok-valid');
    const r = handleSlinkPost({
      token: 'tok-valid',
      body: '{"text":"hello world"}',
      ip: '10.0.0.1',
      group,
      onMessage,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello world');
    expect(messages[0].chat_jid).toBe('web:main');
  });
});

// --- anonymous rate limiting ---

describe('anonymous rate limiting', () => {
  it('returns 429 after anon bucket exhausted', () => {
    const { onMessage } = collect();
    const group = makeGroup('web:ratelimit', 'tok-anon');
    const rpm = 5;

    // Exhaust the bucket
    const results = Array.from({ length: rpm }, () =>
      handleSlinkPost({
        token: 'tok-anon',
        body: '{"text":"ping"}',
        ip: '1.2.3.4',
        group,
        onMessage,
        anonRpm: rpm,
      }),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    // Next request from different IP still hits shared anon bucket
    const blocked = handleSlinkPost({
      token: 'tok-anon',
      body: '{"text":"ping"}',
      ip: '9.9.9.9',
      group,
      onMessage,
      anonRpm: rpm,
    });
    expect(blocked.status).toBe(429);
    expect(JSON.parse(blocked.body)).toMatchObject({ error: 'rate limited' });
  });

  it('separate token = separate anon bucket', () => {
    const { onMessage } = collect();
    const g1 = makeGroup('web:a', 'tok-a');
    const g2 = makeGroup('web:b', 'tok-b');
    const rpm = 2;

    // Exhaust tok-a
    Array.from({ length: rpm }, () =>
      handleSlinkPost({
        token: 'tok-a',
        body: '{"text":"x"}',
        ip: '1.1.1.1',
        group: g1,
        onMessage,
        anonRpm: rpm,
      }),
    );

    // tok-b should still work
    const r = handleSlinkPost({
      token: 'tok-b',
      body: '{"text":"x"}',
      ip: '1.1.1.1',
      group: g2,
      onMessage,
      anonRpm: rpm,
    });
    expect(r.status).toBe(200);
  });
});

// --- authenticated JWT gets separate bucket ---

describe('authenticated JWT', () => {
  it('uses its own per-sub bucket, independent of anon', () => {
    const { onMessage } = collect();
    const group = makeGroup('web:auth', 'tok-auth');
    const jwt = makeJwt({ sub: 'alice', name: 'Alice' });
    const rpm = 3;

    // Exhaust the anon bucket for this token
    Array.from({ length: rpm }, () =>
      handleSlinkPost({
        token: 'tok-auth',
        body: '{"text":"anon"}',
        ip: '1.2.3.4',
        group,
        onMessage,
        anonRpm: rpm,
      }),
    );

    // Authenticated request should succeed (separate bucket)
    const r = handleSlinkPost({
      token: 'tok-auth',
      body: '{"text":"authed"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      group,
      onMessage,
      authRpm: 60,
      anonRpm: rpm,
    });
    expect(r.status).toBe(200);
  });

  it('returns 429 when auth bucket is exhausted', () => {
    const { onMessage } = collect();
    const group = makeGroup('web:auth2', 'tok-auth2');
    const jwt = makeJwt({ sub: 'bob' });
    const rpm = 3;

    Array.from({ length: rpm }, () =>
      handleSlinkPost({
        token: 'tok-auth2',
        body: '{"text":"x"}',
        ip: '1.2.3.4',
        authHeader: `Bearer ${jwt}`,
        group,
        onMessage,
        authRpm: rpm,
      }),
    );

    const blocked = handleSlinkPost({
      token: 'tok-auth2',
      body: '{"text":"x"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      group,
      onMessage,
      authRpm: rpm,
    });
    expect(blocked.status).toBe(429);
  });
});

// --- sender identity ---

describe('sender identity', () => {
  it('uses anon_<hash> without JWT', () => {
    const { messages, onMessage } = collect();
    handleSlinkPost({
      token: 'tok-sender',
      body: '{"text":"hi"}',
      ip: '192.168.1.1',
      group: makeGroup('web:s', 'tok-sender'),
      onMessage,
    });
    expect(messages[0].sender).toMatch(/^anon_[a-f0-9]{8}$/);
    expect('sender_name' in messages[0]).toBe(false);
  });

  it('same IP produces same anon hash', () => {
    const { messages, onMessage } = collect();
    const group = makeGroup('web:s2', 'tok-same');

    handleSlinkPost({
      token: 'tok-same',
      body: '{"text":"a"}',
      ip: '10.0.0.1',
      group,
      onMessage,
    });
    handleSlinkPost({
      token: 'tok-same',
      body: '{"text":"b"}',
      ip: '10.0.0.1',
      group,
      onMessage,
      anonRpm: 100,
    });

    expect(messages[0].sender).toBe(messages[1].sender);
  });

  it('uses JWT sub as sender', () => {
    const { messages, onMessage } = collect();
    const jwt = makeJwt({ sub: 'user-xyz', name: 'Xavier' });
    handleSlinkPost({
      token: 'tok-jwt',
      body: '{"text":"hi"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      group: makeGroup('web:j', 'tok-jwt'),
      onMessage,
    });
    expect(messages[0].sender).toBe('user-xyz');
    expect(messages[0].sender_name).toBe('Xavier');
  });
});

// --- JWT signature verification ---

describe('JWT signature verification', () => {
  const SECRET = 'test-secret-key';

  it('accepts valid signed JWT and uses sub as sender', () => {
    const { messages, onMessage } = collect();
    const jwt = makeSignedJwt({ sub: 'carol', name: 'Carol' }, SECRET);
    const group = makeGroup('web:sig', 'tok-sig');
    const r = handleSlinkPost({
      token: 'tok-sig',
      body: '{"text":"signed"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      authSecret: SECRET,
      group,
      onMessage,
    });
    expect(r.status).toBe(200);
    expect(messages[0].sender).toBe('carol');
    expect(messages[0].sender_name).toBe('Carol');
  });

  it('returns 401 for JWT with wrong signature', () => {
    const { onMessage } = collect();
    const jwt = makeSignedJwt({ sub: 'eve' }, 'wrong-secret');
    const r = handleSlinkPost({
      token: 'tok-badsig',
      body: '{"text":"tampered"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      authSecret: SECRET,
      group: makeGroup('web:badsig', 'tok-badsig'),
      onMessage,
    });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'unauthorized' });
  });

  it('returns 401 for unsigned (alg:none) JWT when authSecret is set', () => {
    const { onMessage } = collect();
    const jwt = makeJwt({ sub: 'mallory' });
    const r = handleSlinkPost({
      token: 'tok-unsigned',
      body: '{"text":"unsigned"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      authSecret: SECRET,
      group: makeGroup('web:unsigned', 'tok-unsigned'),
      onMessage,
    });
    expect(r.status).toBe(401);
  });

  it('treats JWT as anon (no verify) when authSecret is absent', () => {
    const { messages, onMessage } = collect();
    const jwt = makeJwt({ sub: 'nocheck', name: 'NoCheck' });
    const r = handleSlinkPost({
      token: 'tok-nocheck',
      body: '{"text":"hi"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${jwt}`,
      // no authSecret
      group: makeGroup('web:nocheck', 'tok-nocheck'),
      onMessage,
    });
    expect(r.status).toBe(200);
    expect(messages[0].sender).toBe('nocheck');
  });
});

// --- media_url attachment ---

describe('media_url attachment', () => {
  function captureAll(): {
    calls: Parameters<OnInboundMessage>[];
    onMessage: OnInboundMessage;
  } {
    const calls: Parameters<OnInboundMessage>[] = [];
    return { calls, onMessage: (...args) => calls.push(args) };
  }

  it('video url produces type video with source.url containing clip.mp4', () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-media',
      body: '{"text":"look","media_url":"https://cdn.example.com/clip.mp4"}',
      ip: '1.2.3.4',
      group: makeGroup('web:m', 'tok-media'),
      onMessage,
    });
    expect(calls).toHaveLength(1);
    const [, , attachments, download] = calls[0];
    expect(attachments).toHaveLength(1);
    expect(attachments![0].type).toBe('video');
    expect((attachments![0].source as { url: string }).url).toContain(
      'clip.mp4',
    );
    expect(typeof download).toBe('function');
  });

  it('mp3 url → type audio', () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-audio',
      body: '{"text":"listen","media_url":"https://cdn.example.com/song.mp3"}',
      ip: '1.2.3.4',
      group: makeGroup('web:a', 'tok-audio'),
      onMessage,
    });
    expect(calls[0][2]![0].type).toBe('audio');
  });

  it('jpg url → type image', () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-img',
      body: '{"text":"see","media_url":"https://cdn.example.com/photo.jpg"}',
      ip: '1.2.3.4',
      group: makeGroup('web:i', 'tok-img'),
      onMessage,
    });
    expect(calls[0][2]![0].type).toBe('image');
  });

  it('pdf url → type document', () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-doc',
      body: '{"text":"read","media_url":"https://cdn.example.com/file.pdf"}',
      ip: '1.2.3.4',
      group: makeGroup('web:d', 'tok-doc'),
      onMessage,
    });
    expect(calls[0][2]![0].type).toBe('document');
  });

  it('download fn fetches arrayBuffer and returns Buffer', async () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-dl',
      body: '{"text":"get","media_url":"https://cdn.example.com/clip.mp4"}',
      ip: '1.2.3.4',
      group: makeGroup('web:dl', 'tok-dl'),
      onMessage,
    });
    const [, , attachments, download] = calls[0];
    const bytes = Buffer.from('bytes');
    global.fetch = async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => String(bytes.length) },
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
      }) as unknown as Response;
    const result = await download!(attachments![0], 1_000_000);
    expect(result).toEqual(bytes);
  });

  it('download fn rejects with HTTP 403 on non-ok response', async () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-403',
      body: '{"text":"x","media_url":"https://cdn.example.com/clip.mp4"}',
      ip: '1.2.3.4',
      group: makeGroup('web:e', 'tok-403'),
      onMessage,
    });
    const [, , attachments, download] = calls[0];
    global.fetch = async () =>
      ({ ok: false, status: 403 }) as unknown as Response;
    await expect(download!(attachments![0], 1_000_000)).rejects.toThrow(
      'HTTP 403',
    );
  });

  it('download fn rejects with too large when content-length exceeds maxBytes', async () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-big',
      body: '{"text":"x","media_url":"https://cdn.example.com/clip.mp4"}',
      ip: '1.2.3.4',
      group: makeGroup('web:f', 'tok-big'),
      onMessage,
    });
    const [, , attachments, download] = calls[0];
    global.fetch = async () =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => '999999' },
      }) as unknown as Response;
    await expect(download!(attachments![0], 100)).rejects.toThrow('too large');
  });
});

// --- JWT expiry ---

describe('JWT expiry', () => {
  const SECRET = 'test-secret-key';

  it('returns 401 for JWT with exp in the past', () => {
    const { onMessage } = collect();
    const expiredJwt = makeSignedJwt(
      { sub: 'dave', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
    );
    const r = handleSlinkPost({
      token: 'tok-expired',
      body: '{"text":"expired"}',
      ip: '1.2.3.4',
      authHeader: `Bearer ${expiredJwt}`,
      authSecret: SECRET,
      group: makeGroup('web:expired', 'tok-expired'),
      onMessage,
    });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'unauthorized' });
  });
});

// --- malformed base64 in JWT payload ---

describe('malformed JWT payload', () => {
  const SECRET = 'test-secret-key';

  it('treats malformed JWT as anon (no crash) when authSecret is set', () => {
    const { onMessage } = collect();
    const r = handleSlinkPost({
      token: 'tok-malformed',
      body: '{"text":"hi"}',
      ip: '1.2.3.4',
      authHeader: 'Bearer notajwt.!!!.sig',
      authSecret: SECRET,
      group: makeGroup('web:malformed', 'tok-malformed'),
      onMessage,
    });
    // malformed JWT falls through gracefully — not 500
    expect(r.status).not.toBe(500);
  });
});

// --- bucket reset after 60s window ---

describe('rate limit bucket reset', () => {
  it('resets anon bucket after 60s window', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const { onMessage } = collect();
      const group = makeGroup('web:reset', 'tok-reset');
      const rpm = 10;

      // Exhaust the anon bucket
      const results = Array.from({ length: rpm }, () =>
        handleSlinkPost({
          token: 'tok-reset',
          body: '{"text":"ping"}',
          ip: '1.2.3.4',
          group,
          onMessage,
          anonRpm: rpm,
        }),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);

      const blocked = handleSlinkPost({
        token: 'tok-reset',
        body: '{"text":"ping"}',
        ip: '1.2.3.4',
        group,
        onMessage,
        anonRpm: rpm,
      });
      expect(blocked.status).toBe(429);

      // Advance time by 61 seconds to trigger bucket reset
      vi.advanceTimersByTime(61_000);

      const after = handleSlinkPost({
        token: 'tok-reset',
        body: '{"text":"ping"}',
        ip: '1.2.3.4',
        group,
        onMessage,
        anonRpm: rpm,
      });
      expect(after.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});

// --- guessType with query string ---

describe('guessType with query string', () => {
  function captureAll(): {
    calls: Parameters<OnInboundMessage>[];
    onMessage: OnInboundMessage;
  } {
    const calls: Parameters<OnInboundMessage>[] = [];
    return { calls, onMessage: (...args) => calls.push(args) };
  }

  it('video url with query string produces type video', () => {
    const { calls, onMessage } = captureAll();
    handleSlinkPost({
      token: 'tok-qs',
      body: '{"text":"look","media_url":"https://cdn.example.com/clip.mp4?x=1&token=abc"}',
      ip: '1.2.3.4',
      group: makeGroup('web:qs', 'tok-qs'),
      onMessage,
    });
    expect(calls).toHaveLength(1);
    const [, , attachments] = calls[0];
    expect(attachments![0].type).toBe('video');
  });
});

// --- DB: kanipi group add web:test inserts non-null slink_token ---

describe('DB: web group registration', () => {
  it('_setTestGroupRoute with slinkToken stores and retrieves token', () => {
    const token = generateSlinkToken();
    _setTestGroupRoute('web:test', {
      name: 'test',
      folder: 'web-test',
      slinkToken: token,
    });

    const group = getGroupBySlink(token);
    expect(group).toBeDefined();
    expect(group!.jid).toBe('web:test');
    expect(group!.slinkToken).toBe(token);
  });

  it('generateSlinkToken produces a non-empty URL-safe string', () => {
    const token = generateSlinkToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    // base64url: only A-Z a-z 0-9 - _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('group add simulation: web: JID gets non-null slink_token', () => {
    // Simulates what `kanipi group add web:main` does:
    // generate token, insert with slink_token, verify it's stored
    const jid = 'web:main';
    const token = generateSlinkToken();
    expect(token).toBeTruthy();

    _setTestGroupRoute(jid, {
      name: 'root',
      folder: 'root',
      slinkToken: token,
    });

    const row = getGroupBySlink(token);
    expect(row).toBeDefined();
    expect(row!.slinkToken).not.toBeNull();
    expect(row!.slinkToken).not.toBe('');
  });
});
