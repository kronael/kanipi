import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import { addSseListener, removeSseListener } from './channels/web.js';

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
import { startWebProxy, _resetVhosts } from './web-proxy.js';
import type { GroupConfig } from './db.js';
import type { OnInboundMessage } from './types.js';

const mockGetGroup = vi.mocked(getGroupBySlink);
const mockHandleSlink = vi.mocked(handleSlinkPost);
const mockAddSse = vi.mocked(addSseListener);
const mockRemoveSse = vi.mocked(removeSseListener);

function makeGroup(token: string): GroupConfig & { jid: string } {
  return {
    jid: 'web:root',
    name: 'root',
    folder: 'root',
    added_at: new Date().toISOString(),
    slinkToken: token,
  };
}

// Helper: start proxy on a random port, return { port, onMessage, close }
function startProxy(opts?: {
  authSecret?: string;
  webPublic?: boolean;
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
      onMessage,
      authSecret: opts?.authSecret,
      webPublic: opts?.webPublic,
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
): Promise<{
  status: number;
  body: string;
  ct: string;
  location?: string;
}> {
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
            location: res.headers['location'] as string | undefined,
          }),
        );
      })
      .on('error', reject);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetVhosts();
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

  it('calls removeSseListener when client closes the connection', async () => {
    const { port, close } = await startProxy();
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          {
            host: 'localhost',
            port,
            path: '/_sloth/stream?group=testgroup',
          },
          () => {
            // Headers received — connection is open; now destroy to trigger close
            req.destroy();
            resolve();
          },
        );
        req.on('error', () => {});
        req.on('close', resolve);
        req.on('timeout', () => reject(new Error('timeout')));
      });
      // Give the server's close handler time to fire
      await new Promise((r) => setTimeout(r, 30));
      expect(mockRemoveSse).toHaveBeenCalledWith(
        'testgroup',
        expect.anything(),
      );
    } finally {
      await close();
    }
  });
});

describe('GET /_sloth/stream — auth', () => {
  it('returns 401 for stream without session when authSecret set and not webPublic', async () => {
    const { port, close } = await startProxy({ authSecret: 'testsecret' });
    try {
      const result = await new Promise<number>((resolve) => {
        const req = http.get(
          { host: 'localhost', port, path: '/_sloth/stream?group=x' },
          (res) => {
            resolve(res.statusCode ?? 0);
            req.destroy();
          },
        );
        req.on('error', () => {});
      });
      expect(result).toBe(401);
    } finally {
      await close();
    }
  });

  it('allows stream without session when webPublic is true', async () => {
    const { port, close } = await startProxy({
      authSecret: 'testsecret',
      webPublic: true,
    });
    try {
      const result = await new Promise<number>((resolve) => {
        const req = http.get(
          { host: 'localhost', port, path: '/_sloth/stream?group=x' },
          (res) => {
            resolve(res.statusCode ?? 0);
            req.destroy();
          },
        );
        req.on('error', () => {});
      });
      expect(result).toBe(200);
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
      const id = (msg as { id: string }).id;
      expect(id).toMatch(/^web-\d+$/);
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

describe('GET /_sloth/sloth.js', () => {
  it('returns 200 with JS content', async () => {
    const { port, close } = await startProxy();
    try {
      const res = await get(port, '/_sloth/sloth.js');
      expect(res.status).toBe(200);
      expect(res.ct).toContain('javascript');
      expect(res.body).toContain('EventSource');
    } finally {
      await close();
    }
  });
});

describe('POST /_sloth/message edge cases', () => {
  it('defaults group to root when missing', async () => {
    const { port, onMessage, close } = await startProxy();
    try {
      const res = await post(port, '/_sloth/message', '{"msg":"hello"}');
      expect(res.status).toBe(200);
      const [jid] = onMessage.mock.calls[0];
      expect(jid).toBe('web:root');
    } finally {
      await close();
    }
  });

  it('concatenates msg, context, and url into content', async () => {
    const { port, onMessage, close } = await startProxy();
    try {
      await post(
        port,
        '/_sloth/message',
        '{"group":"main","msg":"hello","context":"sidebar","url":"https://example.com"}',
      );
      const [, msg] = onMessage.mock.calls[0];
      const content = (msg as { content: string }).content;
      expect(content).toContain('hello');
      expect(content).toContain('sidebar');
      expect(content).toContain('https://example.com');
    } finally {
      await close();
    }
  });
});

describe('session auth', () => {
  it('redirects / to /pub/ when authSecret is set', async () => {
    const { port, close } = await startProxy({ authSecret: 'testsecret' });
    try {
      const res = await get(port, '/');
      expect(res.status).toBe(302);
    } finally {
      await close();
    }
  });

  it('redirects to /auth/login for protected routes without session', async () => {
    const { port, close } = await startProxy({ authSecret: 'testsecret' });
    try {
      const res = await get(port, '/howto/');
      expect(res.status).toBe(302);
      expect(res.location).toBe('/auth/login');
    } finally {
      await close();
    }
  });

  it('passes /pub/sloth.js without session', async () => {
    const { port, close } = await startProxy({ authSecret: 'testsecret' });
    try {
      const res = await get(port, '/pub/sloth.js');
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('passes POST /pub/s/:token without session', async () => {
    mockGetGroup.mockReturnValue({ jid: 'web:tok', folder: 'root' });
    mockHandleSlink.mockReturnValue({ status: 200, body: '{"ok":true}' });
    const { port, close } = await startProxy({ authSecret: 'testsecret' });
    try {
      const res = await post(port, '/pub/s/tok', '{"text":"hi"}');
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  // /_sloth/ is in PUBLIC_PREFIXES — intentionally unauthenticated so
  // the embedded sloth.js widget can post without user credentials.
  it('passes POST /_sloth/message without session (public widget endpoint)', async () => {
    const { port, onMessage, close } = await startProxy({
      authSecret: 'testsecret',
    });
    try {
      const res = await post(
        port,
        '/_sloth/message',
        '{"group":"main","msg":"hello"}',
      );
      expect(res.status).toBe(200);
      expect(onMessage).toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

describe('vhost redirect', () => {
  const vhosts = { 'krons.fiu.wtf': 'krons', 'atlas.fiu.wtf': 'atlas' };

  function mockVhosts() {
    vi.spyOn(fs, 'statSync').mockReturnValue({
      mtimeMs: Date.now(),
    } as fs.Stats);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(vhosts));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matching host returns 301 redirect to world path', async () => {
    mockVhosts();
    const { port, close } = await startProxy();
    try {
      const res = await get(port, '/page.html', { Host: 'krons.fiu.wtf' });
      expect(res.status).toBe(301);
      expect(res.location).toBe('/krons/page.html');
    } finally {
      await close();
    }
  });

  it('root path redirects to /world/', async () => {
    mockVhosts();
    const { port, close } = await startProxy();
    try {
      const res = await get(port, '/', { Host: 'atlas.fiu.wtf' });
      expect(res.status).toBe(301);
      expect(res.location).toBe('/atlas/');
    } finally {
      await close();
    }
  });

  it('path traversal returns 400', async () => {
    mockVhosts();
    const { port, close } = await startProxy();
    try {
      const res = await get(port, '/../../etc/passwd', {
        Host: 'krons.fiu.wtf',
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('no vhost match falls through to normal proxy', async () => {
    mockVhosts();
    const { port, close } = await startProxy();
    try {
      const res = await get(port, '/', { Host: 'unknown.example.com' });
      expect(res.status).not.toBe(301);
    } finally {
      await close();
    }
  });

  it('no vhosts.json — normal behavior', async () => {
    vi.spyOn(fs, 'statSync').mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const { port, close } = await startProxy();
    try {
      const res = await get(port, '/', { Host: 'krons.fiu.wtf' });
      expect(res.status).not.toBe(301);
    } finally {
      await close();
    }
  });
});
