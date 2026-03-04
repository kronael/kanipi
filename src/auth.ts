import crypto from 'crypto';

import { AUTH_PASSWORD, AUTH_SECRET } from './config.js';
import { createAuthSession, deleteAuthSession, getAuthSession } from './db.js';

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
    if (!r.ok) { err.textContent = 'Wrong password'; err.style.display = ''; return; }
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

export function handleLoginPost(
  body: string,
  secret: string,
): { status: number; headers?: Record<string, string>; body: string } {
  let password: string;
  try {
    password = String(JSON.parse(body).password ?? '');
  } catch {
    return { status: 400, body: '{"error":"bad request"}' };
  }

  if (password !== AUTH_PASSWORD) {
    return { status: 401, body: '{"error":"unauthorized"}' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  createAuthSession(sha256(token), 'local:admin', expiresAt);

  const jwt = mintJwt('local:admin', 'admin', secret);
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

export function checkSessionCookie(cookie: string): boolean {
  const token = parseCookies(cookie || '')['refresh'];
  if (!token) return false;
  const session = getAuthSession(sha256(token));
  if (!session) return false;
  return new Date(session.expires_at) > new Date();
}

// Re-export for web-proxy.ts compat
export { AUTH_SECRET };
