import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import net from 'net';

// We spin up a fake upstream on a fixed port before the mocks are evaluated,
// so the config mock can reference it statically.
// vitest runs top-level module code before vi.mock hoisting — we use a lazy
// getter on the config mock to read fakeWebdavPort at call-time.

let fakeWebdavPort = 0;

vi.mock('./config.js', () => {
  return {
    WEB_DIR: '/tmp/web',
    WEBDAV_ENABLED: true,
    get WEBDAV_URL() {
      return `http://127.0.0.1:${fakeWebdavPort}`;
    },
  };
});

vi.mock('./db.js', () => ({
  getGroupBySlink: vi.fn(),
  getWebdavUser: vi.fn(),
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

vi.mock('./auth.js', () => ({
  checkSessionCookie: vi.fn(() => false),
  handleDiscordAuth: vi.fn(),
  handleDiscordCallback: vi.fn(),
  handleGitHubAuth: vi.fn(),
  handleGitHubCallback: vi.fn(),
  handleGoogleAuth: vi.fn(),
  handleGoogleCallback: vi.fn(),
  handleLoginPost: vi.fn(),
  handleLogout: vi.fn(),
  handleRefresh: vi.fn(),
  handleTelegramAuth: vi.fn(),
  loginPageHtml: vi.fn(() => ''),
}));

vi.mock('./dashboards/index.js', () => ({ handleDashRequest: vi.fn() }));
vi.mock('./dashboards/tasks.js', () => ({}));
vi.mock('./dashboards/activity.js', () => ({}));
vi.mock('./dashboards/groups.js', () => ({}));
vi.mock('./dashboards/memory.js', () => ({}));
vi.mock('./dashboards/onboarding.js', () => ({}));
vi.mock('./dashboards/evangelist.js', () => ({}));

import { getWebdavUser } from './db.js';
import { startWebProxy, _resetVhosts } from './web-proxy.js';
import type { OnInboundMessage } from './types.js';

const mockGetWebdavUser = vi.mocked(getWebdavUser);

function basicAuth(username: string, token: string): string {
  return 'Basic ' + Buffer.from(`${username}:${token}`).toString('base64');
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Minimal fake upstream that replies 207 to everything.
function startFakeWebdav(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(207, { 'Content-Type': 'text/xml' });
      res.end('<ok/>');
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      fakeWebdavPort = port;
      resolve({ port, close: () => server.close() });
    });
  });
}

function startProxy(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const onMessage = vi.fn() as unknown as OnInboundMessage;
    const server = startWebProxy({
      webPort: 0,
      vitePort: 19999,
      onMessage,
      webPublic: true,
    });
    server.once('error', reject);
    server.once('listening', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
  });
}

function request(
  port: number,
  method: string,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: headers || {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetVhosts();
});

describe('/dav/:group/* — Basic Auth', () => {
  it('missing Authorization returns 401', async () => {
    const fake = await startFakeWebdav();
    try {
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'PROPFIND', '/dav/root/');
        expect(res.status).toBe(401);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });

  it('bad token returns 401', async () => {
    const fake = await startFakeWebdav();
    try {
      const token = 'correct-token';
      mockGetWebdavUser.mockReturnValue({
        id: 1,
        sub: 'local:x',
        username: 'alice',
        webdav_token_hash: sha256(token),
        webdav_groups: '["root"]',
      });
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'PROPFIND', '/dav/root/', {
          Authorization: basicAuth('alice', 'wrong-token'),
        });
        expect(res.status).toBe(401);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });

  it('group not in webdav_groups returns 403', async () => {
    const fake = await startFakeWebdav();
    try {
      const token = 'tok1';
      mockGetWebdavUser.mockReturnValue({
        id: 1,
        sub: 'local:x',
        username: 'alice',
        webdav_token_hash: sha256(token),
        webdav_groups: '["other"]',
      });
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'GET', '/dav/root/', {
          Authorization: basicAuth('alice', token),
        });
        expect(res.status).toBe(403);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });

  it('write method on logs/ returns 403', async () => {
    const fake = await startFakeWebdav();
    try {
      const token = 'tok2';
      mockGetWebdavUser.mockReturnValue({
        id: 1,
        sub: 'local:x',
        username: 'alice',
        webdav_token_hash: sha256(token),
        webdav_groups: '["root"]',
      });
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'PUT', '/dav/root/logs/foo.txt', {
          Authorization: basicAuth('alice', token),
        });
        expect(res.status).toBe(403);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });

  it('read method on logs/ is allowed and proxied', async () => {
    const fake = await startFakeWebdav();
    try {
      const token = 'tok3';
      mockGetWebdavUser.mockReturnValue({
        id: 1,
        sub: 'local:x',
        username: 'alice',
        webdav_token_hash: sha256(token),
        webdav_groups: '["root"]',
      });
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'GET', '/dav/root/logs/foo.txt', {
          Authorization: basicAuth('alice', token),
        });
        expect(res.status).toBe(207);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });

  it('valid auth + valid group proxies to upstream', async () => {
    const fake = await startFakeWebdav();
    try {
      const token = 'tok4';
      mockGetWebdavUser.mockReturnValue({
        id: 1,
        sub: 'local:x',
        username: 'alice',
        webdav_token_hash: sha256(token),
        webdav_groups: '["root"]',
      });
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'GET', '/dav/root/notes.md', {
          Authorization: basicAuth('alice', token),
        });
        expect(res.status).toBe(207);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });

  it('write on .env returns 403', async () => {
    const fake = await startFakeWebdav();
    try {
      const token = 'tok5';
      mockGetWebdavUser.mockReturnValue({
        id: 1,
        sub: 'local:x',
        username: 'alice',
        webdav_token_hash: sha256(token),
        webdav_groups: '["root"]',
      });
      const { port, close } = await startProxy();
      try {
        const res = await request(port, 'PUT', '/dav/root/.env', {
          Authorization: basicAuth('alice', token),
        });
        expect(res.status).toBe(403);
      } finally {
        await close();
      }
    } finally {
      fake.close();
    }
  });
});
