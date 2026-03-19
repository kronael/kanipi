import crypto from 'crypto';
import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkSessionCookie,
  handleGitHubAuth,
  handleGitHubCallback,
  handleGoogleAuth,
  handleGoogleCallback,
  handleDiscordAuth,
  handleDiscordCallback,
  handleTelegramAuth,
  mintJwt,
} from './auth.js';
import { _initTestDatabase } from './db.js';

// Mock config values
vi.mock('./config.js', async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    GITHUB_CLIENT_ID: 'test-github-client-id',
    GITHUB_CLIENT_SECRET: 'test-github-client-secret',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    DISCORD_CLIENT_ID: 'test-discord-client-id',
    DISCORD_CLIENT_SECRET: 'test-discord-client-secret',
    TELEGRAM_BOT_TOKEN: 'test-telegram-bot-token',
    AUTH_SECRET: 'test-auth-secret',
    WEB_HOST: 'https://example.com',
  };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockReq(opts: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): http.IncomingMessage {
  const req = new http.IncomingMessage(null as unknown as import('net').Socket);
  req.url = opts.url || '/';
  req.method = opts.method || 'GET';
  req.headers = opts.headers || {};
  if (opts.body) {
    const chunks = [Buffer.from(opts.body)];
    let idx = 0;
    req[Symbol.asyncIterator] = async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    };
  }
  return req;
}

function createMockRes(): http.ServerResponse & {
  _status: number;
  _headers: Record<string, string | string[]>;
  _body: string;
} {
  const res = {
    _status: 200,
    _headers: {} as Record<string, string | string[]>,
    _body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          res._headers[k.toLowerCase()] = v;
        }
      }
      return res;
    },
    end(body?: string) {
      if (body) res._body = body;
    },
  };
  return res as http.ServerResponse & typeof res;
}

describe('mintJwt', () => {
  it('creates a valid JWT', () => {
    const token = mintJwt('user123', 'Test User', 'secret');
    const [header, payload, sig] = token.split('.');

    const h = JSON.parse(Buffer.from(header, 'base64url').toString());
    expect(h).toEqual({ alg: 'HS256', typ: 'JWT' });

    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(p.sub).toBe('user123');
    expect(p.name).toBe('Test User');
    expect(typeof p.exp).toBe('number');

    // Verify signature
    const expected = crypto
      .createHmac('sha256', 'secret')
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(sig).toBe(expected);
  });
});

describe('handleGitHubAuth', () => {
  it('redirects to GitHub OAuth authorize URL', () => {
    const req = createMockReq({
      url: '/auth/github',
      headers: { host: 'localhost:3000' },
    });
    const res = createMockRes();

    handleGitHubAuth(req, res);

    expect(res._status).toBe(302);
    expect(res._headers['location']).toContain(
      'https://github.com/login/oauth/authorize',
    );
    expect(res._headers['location']).toContain(
      'client_id=test-github-client-id',
    );
    expect(res._headers['location']).toContain('redirect_uri=');
    expect(res._headers['location']).toContain('state=');
    expect(res._headers['set-cookie']).toContain('oauth_state=');
  });
});

describe('handleGitHubCallback', () => {
  beforeEach(() => {
    _initTestDatabase();
    mockFetch.mockReset();
  });

  it('rejects invalid state', async () => {
    const req = createMockReq({
      url: '/auth/github/callback?code=abc&state=wrong',
      headers: { host: 'localhost:3000', cookie: 'oauth_state=correct' },
    });
    const res = createMockRes();

    await handleGitHubCallback(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('invalid state');
  });

  it('exchanges code for token and creates session', async () => {
    const state = 'test-state-123';
    const req = createMockReq({
      url: `/auth/github/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000', cookie: `oauth_state=${state}` },
    });
    const res = createMockRes();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'gh-token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 12345, login: 'testuser', name: 'Test User' }),
      });

    await handleGitHubCallback(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gh-token-123',
        }),
      }),
    );

    expect(res._status).toBe(302);
    expect(res._headers['location']).toBe('/');
    expect(res._headers['set-cookie']).toContain('refresh=');
  });

  it('handles token exchange failure', async () => {
    const state = 'test-state-123';
    const req = createMockReq({
      url: `/auth/github/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000', cookie: `oauth_state=${state}` },
    });
    const res = createMockRes();

    mockFetch.mockResolvedValueOnce({ ok: false });

    await handleGitHubCallback(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toContain('token exchange failed');
  });
});

describe('handleGoogleAuth', () => {
  it('redirects to Google OAuth authorize URL', () => {
    const req = createMockReq({
      url: '/auth/google',
      headers: { host: 'localhost:3000' },
    });
    const res = createMockRes();

    handleGoogleAuth(req, res);

    expect(res._status).toBe(302);
    expect(res._headers['location']).toContain(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(res._headers['location']).toContain(
      'client_id=test-google-client-id',
    );
    expect(res._headers['location']).toContain('redirect_uri=');
    expect(res._headers['location']).toContain('state=');
    expect(res._headers['set-cookie']).toContain('oauth_state=');
  });
});

describe('handleGoogleCallback', () => {
  beforeEach(() => {
    _initTestDatabase();
    mockFetch.mockReset();
  });

  it('rejects invalid state', async () => {
    const req = createMockReq({
      url: '/auth/google/callback?code=abc&state=wrong',
      headers: { host: 'localhost:3000', cookie: 'oauth_state=correct' },
    });
    const res = createMockRes();

    await handleGoogleCallback(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('invalid state');
  });

  it('exchanges code for token and creates session', async () => {
    const state = 'test-state-123';
    const req = createMockReq({
      url: `/auth/google/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000', cookie: `oauth_state=${state}` },
    });
    const res = createMockRes();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'gg-token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: '1234567890',
          email: 'testuser@gmail.com',
          name: 'Test User',
        }),
      });

    await handleGoogleCallback(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://www.googleapis.com/oauth2/v3/userinfo',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer gg-token-123',
        }),
      }),
    );

    expect(res._status).toBe(302);
    expect(res._headers['location']).toBe('/');
    expect(res._headers['set-cookie']).toContain('refresh=');
  });

  it('handles token exchange failure', async () => {
    const state = 'test-state-123';
    const req = createMockReq({
      url: `/auth/google/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000', cookie: `oauth_state=${state}` },
    });
    const res = createMockRes();

    mockFetch.mockResolvedValueOnce({ ok: false });

    await handleGoogleCallback(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toContain('token exchange failed');
  });
});

describe('handleDiscordAuth', () => {
  it('redirects to Discord OAuth authorize URL', () => {
    const req = createMockReq({
      url: '/auth/discord',
      headers: { host: 'localhost:3000' },
    });
    const res = createMockRes();

    handleDiscordAuth(req, res);

    expect(res._status).toBe(302);
    expect(res._headers['location']).toContain(
      'https://discord.com/api/oauth2/authorize',
    );
    expect(res._headers['location']).toContain(
      'client_id=test-discord-client-id',
    );
    expect(res._headers['location']).toContain('redirect_uri=');
    expect(res._headers['location']).toContain('state=');
    expect(res._headers['set-cookie']).toContain('oauth_state=');
  });
});

describe('handleDiscordCallback', () => {
  beforeEach(() => {
    _initTestDatabase();
    mockFetch.mockReset();
  });

  it('rejects invalid state', async () => {
    const req = createMockReq({
      url: '/auth/discord/callback?code=abc&state=wrong',
      headers: { host: 'localhost:3000', cookie: 'oauth_state=correct' },
    });
    const res = createMockRes();

    await handleDiscordCallback(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('invalid state');
  });

  it('exchanges code for token and creates session', async () => {
    const state = 'test-state-123';
    const req = createMockReq({
      url: `/auth/discord/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000', cookie: `oauth_state=${state}` },
    });
    const res = createMockRes();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'dc-token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '999888777',
          username: 'discorduser',
          global_name: 'Discord User',
        }),
      });

    await handleDiscordCallback(req, res);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://discord.com/api/oauth2/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://discord.com/api/users/@me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer dc-token-123',
        }),
      }),
    );

    expect(res._status).toBe(302);
    expect(res._headers['location']).toBe('/');
    expect(res._headers['set-cookie']).toContain('refresh=');
  });

  it('handles user fetch failure', async () => {
    const state = 'test-state-123';
    const req = createMockReq({
      url: `/auth/discord/callback?code=abc&state=${state}`,
      headers: { host: 'localhost:3000', cookie: `oauth_state=${state}` },
    });
    const res = createMockRes();

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'dc-token-123' }),
      })
      .mockResolvedValueOnce({ ok: false });

    await handleDiscordCallback(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toContain('failed to fetch user');
  });
});

describe('handleTelegramAuth', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  function createTelegramData(botToken: string): Record<string, string> {
    const data: Record<string, string> = {
      id: '123456789',
      first_name: 'Test',
      last_name: 'User',
      username: 'testuser',
      auth_date: String(Math.floor(Date.now() / 1000)),
    };

    // Create hash
    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const checkString = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');
    data.hash = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    return data;
  }

  it('validates and creates session for valid Telegram data', async () => {
    const data = createTelegramData('test-telegram-bot-token');
    const req = createMockReq({
      url: '/auth/telegram',
      method: 'POST',
      body: JSON.stringify(data),
    });
    const res = createMockRes();

    await handleTelegramAuth(req, res);

    expect(res._status).toBe(302);
    const body = JSON.parse(res._body);
    expect(body.token).toBeDefined();
  });

  it('rejects invalid hash', async () => {
    const data = createTelegramData('test-telegram-bot-token');
    data.hash = 'invalid-hash';
    const req = createMockReq({
      url: '/auth/telegram',
      method: 'POST',
      body: JSON.stringify(data),
    });
    const res = createMockRes();

    await handleTelegramAuth(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toContain('invalid hash');
  });

  it('rejects expired auth_date', async () => {
    const data = createTelegramData('test-telegram-bot-token');
    // Set auth_date to 2 days ago
    data.auth_date = String(Math.floor(Date.now() / 1000) - 2 * 86400);
    // Recalculate hash with old date
    const secretKey = crypto
      .createHash('sha256')
      .update('test-telegram-bot-token')
      .digest();
    const checkString = Object.keys(data)
      .filter((k) => k !== 'hash')
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');
    data.hash = crypto
      .createHmac('sha256', secretKey)
      .update(checkString)
      .digest('hex');

    const req = createMockReq({
      url: '/auth/telegram',
      method: 'POST',
      body: JSON.stringify(data),
    });
    const res = createMockRes();

    await handleTelegramAuth(req, res);

    expect(res._status).toBe(401);
    expect(res._body).toContain('auth data expired');
  });

  it('rejects missing hash', async () => {
    const data = {
      id: '123',
      first_name: 'Test',
      auth_date: String(Math.floor(Date.now() / 1000)),
    };
    const req = createMockReq({
      url: '/auth/telegram',
      method: 'POST',
      body: JSON.stringify(data),
    });
    const res = createMockRes();

    await handleTelegramAuth(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('missing hash');
  });

  it('rejects invalid JSON', async () => {
    const req = createMockReq({
      url: '/auth/telegram',
      method: 'POST',
      body: 'not json',
    });
    const res = createMockRes();

    await handleTelegramAuth(req, res);

    expect(res._status).toBe(400);
    expect(res._body).toContain('invalid json');
  });
});

describe('checkSessionCookie', () => {
  beforeEach(() => {
    _initTestDatabase();
  });

  it('returns false for empty cookie', () => {
    expect(checkSessionCookie('')).toBe(false);
  });

  it('returns false for non-existent session', () => {
    expect(checkSessionCookie('refresh=nonexistent')).toBe(false);
  });
});
