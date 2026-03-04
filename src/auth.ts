import crypto from 'crypto';

import { verify } from '@node-rs/argon2';

import {
  createAuthSession,
  deleteAuthSession,
  getAuthSession,
  getAuthUserByUsername,
} from './db.js';

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
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Login</title>
<style>
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}
form{background:#fff;padding:2rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);display:flex;flex-direction:column;gap:1rem;min-width:280px}
input{padding:.5rem;border:1px solid #ccc;border-radius:4px;font-size:1rem}
button{padding:.5rem;background:#333;color:#fff;border:none;border-radius:4px;font-size:1rem;cursor:pointer}
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
  const token = parseCookies(cookie || '')['refresh'];
  if (token) deleteAuthSession(sha256(token));
}

export function handleRefresh(
  cookie: string,
  secret: string,
): { status: number; headers?: Record<string, string>; body: string } {
  const oldToken = parseCookies(cookie || '')['refresh'];
  if (!oldToken) return { status: 401, body: '{"error":"unauthorized"}' };
  const session = getAuthSession(sha256(oldToken));
  if (!session || new Date(session.expires_at) <= new Date()) {
    return { status: 401, body: '{"error":"unauthorized"}' };
  }
  deleteAuthSession(sha256(oldToken));
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  createAuthSession(sha256(newToken), session.user_sub, expiresAt);
  const jwt = mintJwt(session.user_sub, session.user_sub, secret);
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
  const token = parseCookies(cookie || '')['refresh'];
  if (!token) return false;
  const session = getAuthSession(sha256(token));
  if (!session) return false;
  return new Date(session.expires_at) > new Date();
}
