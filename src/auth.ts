import crypto from 'crypto';
import http from 'http';

import { verify } from '@node-rs/argon2';

import {
  createAuthSession,
  createAuthUser,
  deleteAuthSession,
  getAuthSession,
  getAuthUserBySub,
  getAuthUserByUsername,
} from './db.js';
import {
  AUTH_SECRET,
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  GITHUB_ALLOWED_ORG,
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GOOGLE_ALLOWED_DOMAIN,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  TELEGRAM_BOT_TOKEN,
  WEB_HOST,
} from './config.js';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(
      part.slice(eq + 1).trim(),
    );
  }
  return out;
}

export function mintJwt(sub: string, name: string, secret: string): string {
  const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
  const p = Buffer.from(
    JSON.stringify({ sub, name, exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${h}.${p}`)
    .digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function loginPageHtml(): string {
  const oauthButtons: string[] = [];
  if (GITHUB_CLIENT_ID) {
    oauthButtons.push(
      '<a href="/auth/github" class="oauth-btn gh">Sign in with GitHub</a>',
    );
  }
  if (GOOGLE_CLIENT_ID) {
    oauthButtons.push(
      '<a href="/auth/google" class="oauth-btn gg">Sign in with Google</a>',
    );
  }
  if (DISCORD_CLIENT_ID) {
    oauthButtons.push(
      '<a href="/auth/discord" class="oauth-btn dc">Sign in with Discord</a>',
    );
  }
  if (TELEGRAM_BOT_TOKEN) {
    oauthButtons.push(
      '<a href="javascript:void(0)" class="oauth-btn tg" onclick="alert(\'Use the Telegram Login Widget on your site\')">Sign in with Telegram</a>',
    );
  }
  const oauthSection = oauthButtons.length
    ? `<div class="divider"><span>or</span></div>${oauthButtons.join('\n  ')}`
    : '';
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Login</title>
<style>
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}
form{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:1rem;min-width:280px}
input{padding:.5rem;border:1px solid #ccc;border-radius:4px;font-size:1rem}
button{padding:.5rem;background:#333;color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer}
.oauth-btn{display:block;text-align:center;padding:.5rem;border-radius:4px;font-size:1rem;text-decoration:none;color:#fff}
.oauth-btn.gh{background:#24292e}
.oauth-btn.gg{background:#4285f4}
.oauth-btn.dc{background:#5865f2}
.oauth-btn.tg{background:#0088cc}
.divider{text-align:center;color:#999;font-size:.85rem;margin:.5rem 0}
.divider span{background:#fff;padding:0 .5rem}
#err{color:#c00;font-size:.9rem;display:none}
</style>
</head>
<body>
<form id="f">
  <h2 style="margin:0">Sign in</h2>
  <input name="username" placeholder="Username" required autocomplete="username">
  <input name="password" type="password" placeholder="Password" required autocomplete="current-password">
  <button type="submit">Sign in</button>
  <div id="err"></div>
  ${oauthSection}
</form>
<script>
document.getElementById('f').addEventListener('submit', async function(e) {
  e.preventDefault();
  var err = document.getElementById('err');
  err.style.display = 'none';
  var data = Object.fromEntries(new FormData(this));
  try {
    var r = await fetch('/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    if (!r.ok) { err.textContent = 'Invalid username or password'; err.style.display = ''; return; }
    var j = await r.json();
    try { localStorage.setItem('sloth_jwt', j.token); } catch(_) {}
    location.href = '/';
  } catch(_) {
    err.textContent = 'Network error'; err.style.display = '';
  }
});
</script>
</body>
</html>`;
}

export async function handleLoginPost(
  body: string,
  secret: string,
): Promise<{ status: number; headers?: Record<string, string>; body: string }> {
  let username: string;
  let password: string;
  try {
    const parsed = JSON.parse(body);
    username = String(parsed.username ?? '');
    password = String(parsed.password ?? '');
  } catch {
    return { status: 400, body: '{"error":"bad request"}' };
  }

  const user = getAuthUserByUsername(username);
  if (!user) return { status: 401, body: '{"error":"unauthorized"}' };

  let ok = false;
  try {
    ok = await verify(user.hash, password);
  } catch {
    return { status: 401, body: '{"error":"unauthorized"}' };
  }
  if (!ok) return { status: 401, body: '{"error":"unauthorized"}' };

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  createAuthSession(sha256(token), user.sub, expiresAt);

  const jwt = mintJwt(user.sub, user.name, secret);
  return {
    status: 200,
    headers: {
      'Set-Cookie': `refresh=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: jwt }),
  };
}

export function handleLogout(cookie: string): void {
  const token = parseCookies(cookie)['refresh'];
  if (token) deleteAuthSession(sha256(token));
}

export function handleRefresh(
  cookie: string,
  secret: string,
): { status: number; headers?: Record<string, string>; body: string } {
  const oldToken = parseCookies(cookie)['refresh'];
  if (!oldToken) return { status: 401, body: '{"error":"unauthorized"}' };
  const session = getAuthSession(sha256(oldToken));
  if (!session || new Date(session.expires_at) <= new Date()) {
    return { status: 401, body: '{"error":"unauthorized"}' };
  }
  deleteAuthSession(sha256(oldToken));
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  createAuthSession(sha256(newToken), session.user_sub, expiresAt);
  const user = getAuthUserBySub(session.user_sub);
  const jwt = mintJwt(session.user_sub, user?.name ?? session.user_sub, secret);
  return {
    status: 200,
    headers: {
      'Set-Cookie': `refresh=${newToken}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Strict`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: jwt }),
  };
}

export function checkSessionCookie(cookie: string): boolean {
  const token = parseCookies(cookie)['refresh'];
  if (!token) return false;
  const session = getAuthSession(sha256(token));
  return !!session && new Date(session.expires_at) > new Date();
}

// --- OAuth ---

function getBaseUrl(req: http.IncomingMessage): string {
  if (WEB_HOST) return WEB_HOST.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function createOAuthSession(
  sub: string,
  name: string,
  username: string,
): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  let user = getAuthUserBySub(sub);
  if (!user) {
    user = createAuthUser(sub, username, '', name);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  createAuthSession(sha256(token), user.sub, expiresAt);

  const jwt = mintJwt(user.sub, user.name, AUTH_SECRET);
  return {
    status: 302,
    headers: {
      'Set-Cookie': `refresh=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
      Location: '/',
      'Content-Type': 'text/html',
    },
    body: `<!doctype html><html><head><script>localStorage.setItem('sloth_jwt','${jwt}');location.href='/';</script></head><body></body></html>`,
  };
}

export function handleGitHubAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const baseUrl = getBaseUrl(req);
  const redirectUri = encodeURIComponent(`${baseUrl}/auth/github/callback`);
  const scope = encodeURIComponent('read:user user:email');

  res.writeHead(302, {
    'Set-Cookie': `oauth_state=${state}; HttpOnly; Path=/auth; Max-Age=600; SameSite=Lax`,
    Location: `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}`,
  });
  res.end();
}

export async function handleGitHubCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = parseCookies(req.headers.cookie || '')['oauth_state'];

  if (!code || !state || state !== storedState) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"invalid state"}');
    return;
  }

  const baseUrl = getBaseUrl(req);
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${baseUrl}/auth/github/callback`,
    }),
  });

  if (!tokenRes.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"token exchange failed"}');
    return;
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(`{"error":"${tokenData.error || 'no access token'}"}`);
    return;
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/json',
      'User-Agent': 'kanipi',
    },
  });

  if (!userRes.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"failed to fetch user"}');
    return;
  }

  const userData = (await userRes.json()) as {
    id: number;
    login: string;
    name?: string;
  };

  if (GITHUB_ALLOWED_ORG) {
    const memberRes = await fetch(
      `https://api.github.com/orgs/${GITHUB_ALLOWED_ORG}/members/${userData.login}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/json',
          'User-Agent': 'kanipi',
        },
      },
    );
    if (memberRes.status !== 204) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><html><body><p>Access denied: must be a member of ${GITHUB_ALLOWED_ORG}.</p><a href="/auth/login">Back</a></body></html>`,
      );
      return;
    }
  }

  const sub = `github:${userData.id}`;
  const name = userData.name || userData.login;
  const username = `gh_${userData.login}`;

  const result = createOAuthSession(sub, name, username);
  res.writeHead(result.status, result.headers);
  res.end(result.body);
}

export function handleGoogleAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const baseUrl = getBaseUrl(req);
  const redirectUri = encodeURIComponent(`${baseUrl}/auth/google/callback`);
  const scope = encodeURIComponent('openid email profile');

  res.writeHead(302, {
    'Set-Cookie': `oauth_state=${state}; HttpOnly; Path=/auth; Max-Age=600; SameSite=Lax`,
    Location: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`,
  });
  res.end();
}

export async function handleGoogleCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = parseCookies(req.headers.cookie || '')['oauth_state'];

  if (!code || !state || state !== storedState) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"invalid state"}');
    return;
  }

  const baseUrl = getBaseUrl(req);
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${baseUrl}/auth/google/callback`,
    }).toString(),
  });

  if (!tokenRes.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"token exchange failed"}');
    return;
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(`{"error":"${tokenData.error || 'no access token'}"}`);
    return;
  }

  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userRes.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"failed to fetch user"}');
    return;
  }

  const userData = (await userRes.json()) as {
    sub: string;
    email?: string;
    name?: string;
  };

  if (
    GOOGLE_ALLOWED_DOMAIN &&
    !userData.email?.endsWith('@' + GOOGLE_ALLOWED_DOMAIN)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end(
      `<!doctype html><html><body><p>Access denied: only @${GOOGLE_ALLOWED_DOMAIN} accounts are allowed.</p><a href="/auth/login">Back</a></body></html>`,
    );
    return;
  }

  const sub = `google:${userData.sub}`;
  const name = userData.name || (userData.email?.split('@')[0] ?? sub);
  const username = `gg_${userData.email?.split('@')[0] ?? userData.sub}`;

  const result = createOAuthSession(sub, name, username);
  res.writeHead(result.status, result.headers);
  res.end(result.body);
}

export function handleDiscordAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const baseUrl = getBaseUrl(req);
  const redirectUri = encodeURIComponent(`${baseUrl}/auth/discord/callback`);
  const scope = encodeURIComponent('identify');

  res.writeHead(302, {
    'Set-Cookie': `oauth_state=${state}; HttpOnly; Path=/auth; Max-Age=600; SameSite=Lax`,
    Location: `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`,
  });
  res.end();
}

export async function handleDiscordCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = parseCookies(req.headers.cookie || '')['oauth_state'];

  if (!code || !state || state !== storedState) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"invalid state"}');
    return;
  }

  const baseUrl = getBaseUrl(req);
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${baseUrl}/auth/discord/callback`,
    }).toString(),
  });

  if (!tokenRes.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"token exchange failed"}');
    return;
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(`{"error":"${tokenData.error || 'no access token'}"}`);
    return;
  }

  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
    },
  });

  if (!userRes.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"failed to fetch user"}');
    return;
  }

  const userData = (await userRes.json()) as {
    id: string;
    username: string;
    global_name?: string;
  };
  const sub = `discord:${userData.id}`;
  const name = userData.global_name || userData.username;
  const username = `dc_${userData.username}`;

  const result = createOAuthSession(sub, name, username);
  res.writeHead(result.status, result.headers);
  res.end(result.body);
}

export async function handleTelegramAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !AUTH_SECRET) {
    res.writeHead(404);
    res.end();
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  let data: Record<string, string>;
  try {
    data = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"invalid json"}');
    return;
  }

  const { hash, ...rest } = data;
  if (!hash) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end('{"error":"missing hash"}');
    return;
  }

  const authDate = parseInt(rest.auth_date || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"auth data expired"}');
    return;
  }

  const secretKey = crypto
    .createHash('sha256')
    .update(TELEGRAM_BOT_TOKEN)
    .digest();
  const checkString = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('\n');
  const hmac = crypto
    .createHmac('sha256', secretKey)
    .update(checkString)
    .digest('hex');

  if (hmac !== hash) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"invalid hash"}');
    return;
  }

  const sub = `telegram:${rest.id}`;
  const name =
    [rest.first_name, rest.last_name].filter(Boolean).join(' ') ||
    rest.username ||
    sub;
  const username = `tg_${rest.username || rest.id}`;

  const result = createOAuthSession(sub, name, username);
  res.writeHead(result.status, {
    ...result.headers,
    'Content-Type': 'application/json',
  });
  const jwt = mintJwt(sub, name, AUTH_SECRET);
  res.end(JSON.stringify({ token: jwt }));
}
