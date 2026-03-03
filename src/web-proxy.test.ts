import { describe, it, expect, beforeEach, vi } from 'vitest';
import http from 'http';
import { addSseListener } from './channels/web.js';

// --- Mocks ---

vi.mock('./db.js', () => ({
  getGroupBySlink: vi.fn(),
}));

vi.mock('./slink.js', () => ({
  handleSlinkPost: vi.fn(),
}));

vi.mock('./channels/web.js', () => ({
  addSseListener: vi.fn(),
  removeSseListener: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getGroupBySlink } from './db.js';
import { handleSlinkPost } from './slink.js';
import { startWebProxy } from './web-proxy.js';
import type { OnInboundMessage, RegisteredGroup } from './types.js';

const mockGetGroup = vi.mocked(getGroupBySlink);
const mockHandleSlink = vi.mocked(handleSlinkPost);
const mockAddSse = vi.mocked(addSseListener);

function makeGroup(token: string): RegisteredGroup & { jid: string } {
  return {
    jid: 'web:main',
    name: 'main',
    folder: 'main',
    trigger: '',
    added_at: new Date().toISOString(),
    requiresTrigger: false,
    slinkToken: token,
  };
}

// Helper: start proxy on a random port, return { port, onMessage, close }
function startProxy(opts?: {
  authSecret?: string;
  slothUsers?: string;
}): Promise<{
  port: number;
  onMessage: ReturnType<typeof vi.fn>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const onMessage = vi.fn() as unknown as OnInboundMessage;
    const server = startWebProxy({
      webPort: 0,
      vitePort: 9999,
      slothUsers: opts?.slothUsers ?? '',
      onMessage,
      authSecret: opts?.authSecret,
    });
    server.once('error', reject);
    server.once('listening', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        onMessage: onMessage as ReturnType<typeof vi.fn>,
        close: () =>
          new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

function post(
  port: number,
  path: string,
  body: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string; ct: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path, headers }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            ct: res.headers['content-type'] ?? '',
          }),
        );
      })
      .on('error', reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /pub/sloth.js', () => {
  it('returns 200 with JS content', async () => {
    const { port } = await startProxy();
    const res = await get(port, '/pub/sloth.js');
    expect(res.status).toBe(200);
    expect(res.ct).toContain('javascript');
    expect(res.body).toContain('function');
  });
});

describe('POST /pub/s/:token', () => {
  it('valid token returns 200 ok', async () => {
    const { port } = await startProxy();
    const group = makeGroup('tok-abc');
    mockGetGroup.mockReturnValue(group);
    mockHandleSlink.mockReturnValue({ status: 200, body: '{"ok":true}' });
    const res = await post(port, '/pub/s/tok-abc', '{"text":"hi"}');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true });
    expect(mockHandleSlink).toHaveBeenCalledOnce();
  });

  it('unknown token returns 404', async () => {
    const { port } = await startProxy();
    mockGetGroup.mockReturnValue(null);
    mockHandleSlink.mockReturnValue({
      status: 404,
      body: '{"error":"not found"}',
    });
    const res = await post(port, '/pub/s/unknown-tok', '{"text":"hi"}');
    expect(res.status).toBe(404);
  });

  it('rate limited returns 429', async () => {
    const { port } = await startProxy();
    const group = makeGroup('tok-rl');
    mockGetGroup.mockReturnValue(group);
    mockHandleSlink.mockReturnValue({
      status: 429,
      body: '{"error":"rate limited"}',
    });
    const res = await post(port, '/pub/s/tok-rl', '{"text":"x"}');
    expect(res.status).toBe(429);
  });

  it('passes authHeader to handleSlinkPost for JWT sub', async () => {
    const { port } = await startProxy();
    const group = makeGroup('tok-jwt');
    mockGetGroup.mockReturnValue(group);
    mockHandleSlink.mockReturnValue({ status: 200, body: '{"ok":true}' });
    await post(port, '/pub/s/tok-jwt', '{"text":"hi"}', {
      Authorization: 'Bearer sometoken',
    });
    expect(mockHandleSlink).toHaveBeenCalledWith(
      expect.objectContaining({ authHeader: 'Bearer sometoken' }),
    );
  });

  it('invalid JWT when authSecret set returns 401', async () => {
    const { port, close } = await startProxy({ authSecret: 'secret' });
    try {
      const group = makeGroup('tok-badsig');
      mockGetGroup.mockReturnValue(group);
      mockHandleSlink.mockReturnValue({
        status: 401,
        body: '{"error":"unauthorized"}',
      });
      const res = await post(port, '/pub/s/tok-badsig', '{"text":"x"}', {
        Authorization: 'Bearer bad.jwt.sig',
      });
      expect(res.status).toBe(401);
      expect(mockHandleSlink).toHaveBeenCalledWith(
        expect.objectContaining({ authSecret: 'secret' }),
      );
    } finally {
      await close();
    }
  });

  it('x-forwarded-for first IP passed to handleSlinkPost', async () => {
    const { port, close } = await startProxy();
    try {
      mockGetGroup.mockReturnValue(makeGroup('tok-xff'));
      mockHandleSlink.mockReturnValue({ status: 200, body: '{"ok":true}' });
      await post(port, '/pub/s/tok-xff', '{"text":"x"}', {
        'X-Forwarded-For': '203.0.113.5, 10.0.0.1',
      });
      expect(mockHandleSlink).toHaveBeenCalledWith(
        expect.objectContaining({ ip: '203.0.113.5' }),
      );
    } finally {
      await close();
    }
  });

  it('body with media_url is passed through to handleSlinkPost', async () => {
    const { port, close } = await startProxy();
    try {
      mockGetGroup.mockReturnValue(makeGroup('tok-media'));
      mockHandleSlink.mockReturnValue({ status: 200, body: '{"ok":true}' });
      const body = '{"text":"look","media_url":"https://example.com/clip.mp4"}';
      await post(port, '/pub/s/tok-media', body);
      expect(mockHandleSlink).toHaveBeenCalledWith(
        expect.objectContaining({ body }),
      );
    } finally {
      await close();
    }
  });
});

describe('GET /_sloth/stream', () => {
  it('returns 200 text/event-stream and registers SSE listener', async () => {
    const { port, close } = await startProxy();
    try {
      const result = await new Promise<{ status: number; ct: string }>(
        (resolve, reject) => {
          const req = http.get(
            {
              host: 'localhost',
              port,
              path: '/_sloth/stream?group=mygroup',
            },
            (res) => {
              resolve({
                status: res.statusCode ?? 0,
                ct: res.headers['content-type'] ?? '',
              });
              req.destroy();
            },
          );
          req.on('error', () => {});
        },
      );
      expect(result.status).toBe(200);
      expect(result.ct).toContain('text/event-stream');
      await new Promise((r) => setTimeout(r, 10));
      expect(mockAddSse).toHaveBeenCalledWith('mygroup', expect.anything());
    } finally {
      await close();
    }
  });
});

describe('POST /_sloth/message', () => {
  it('dispatches to onMessage with web jid', async () => {
    const { port, onMessage, close } = await startProxy();
    try {
      const res = await post(
        port,
        '/_sloth/message',
        '{"group":"main","msg":"hello"}',
      );
      expect(res.status).toBe(200);
      expect(onMessage).toHaveBeenCalledOnce();
      const [jid, msg] = onMessage.mock.calls[0];
      expect(jid).toBe('web:main');
      expect((msg as { content: string }).content).toContain('hello');
    } finally {
      await close();
    }
  });

  it('returns 400 for malformed JSON', async () => {
    const { port, onMessage, close } = await startProxy();
    try {
      const res = await post(port, '/_sloth/message', '{not valid json}');
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ ok: false });
      expect(onMessage).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

describe('basic auth', () => {
  it('blocks / without credentials', async () => {
    const { port, close } = await startProxy({ slothUsers: 'alice:secret' });
    try {
      const res = await get(port, '/');
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('passes /pub/sloth.js without credentials', async () => {
    const { port, close } = await startProxy({ slothUsers: 'alice:secret' });
    try {
      const res = await get(port, '/pub/sloth.js');
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});
