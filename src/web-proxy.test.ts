import { describe, it, expect, beforeEach, vi } from 'vitest';
import http from 'http';

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

function noop(): OnInboundMessage {
  return vi.fn();
}

// Helper: start proxy on a random port, return { port, close }
function startProxy(opts?: {
  authSecret?: string;
  slothUsers?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const onMessage = noop();
    // startWebProxy doesn't return the server, so we need to capture the port
    // by listening ourselves. Instead, create a temp server to find a free port.
    const tmp = http.createServer();
    tmp.listen(0, () => {
      const port = (tmp.address() as { port: number }).port;
      tmp.close(() => {
        startWebProxy({
          webPort: port,
          vitePort: 9999,
          slothUsers: opts?.slothUsers ?? '',
          onMessage,
          authSecret: opts?.authSecret,
        });
        // Give it a tick to bind
        setTimeout(() => {
          resolve({
            port,
            close: () => Promise.resolve(),
          });
        }, 50);
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
): Promise<{ status: number; body: string; ct: string }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path }, (res) => {
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
    const { port } = await startProxy({ authSecret: 'secret' });
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
  });
});
