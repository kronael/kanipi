import crypto from 'crypto';
import http from 'http';

import { SLINK_ANON_RPM, SLINK_AUTH_RPM } from './config.js';
import { getGroupBySlink } from './db.js';
import { logger } from './logger.js';
import { addSseListener, removeSseListener } from './channels/web.js';
import type { OnInboundMessage } from './types.js';

// --- Slink rate limiter (sliding window, in-memory) ---

interface RateBucket {
  timestamps: number[];
}

const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(key: string, rpm: number): boolean {
  const now = Date.now();
  const window = 60_000;
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateBuckets.set(key, bucket);
  }
  // Prune old entries
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < window);
  if (bucket.timestamps.length >= rpm) return true;
  bucket.timestamps.push(now);
  return false;
}

// --- JWT verification (HS256 only, no external deps) ---

interface JwtClaims {
  sub?: string;
  name?: string;
  exp?: number;
}

function verifyJwt(token: string, secret: string): JwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    if (expected !== sig) return null;
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf-8'),
    ) as JwtClaims;
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// Stub sloth.js body — full implementation TBD
const PUB_SLOTH_JS = `/* sloth public client — stub */`;

// Minimal sloth client — injected into every HTML page served by the proxy
const SLOTH_JS = `(function(){
  var group = document.currentScript && document.currentScript.dataset.group || 'main';

  function post(msg, ctx, url) {
    return fetch('/_sloth/message', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({group: group, msg: msg, context: ctx, url: url})
    });
  }

  function container() {
    var el = document.getElementById('sloth-responses');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sloth-responses';
      document.body.appendChild(el);
    }
    return el;
  }

  function attach(el) {
    el.addEventListener('click', function(e) {
      e.preventDefault();
      var tmpl = el.dataset.sloth;
      var sel = window.getSelection ? window.getSelection().toString() : '';
      var msg = tmpl
        .replace('{{text}}', el.textContent || '')
        .replace('{{selection}}', sel);
      var status = document.createElement('span');
      status.textContent = ' …';
      el.appendChild(status);
      post(msg, el.dataset.slothContext || '', window.location.href)
        .then(function(r){ status.textContent = r.ok ? ' ✓' : ' ✗'; })
        .catch(function(){ status.textContent = ' ✗'; })
        .finally(function(){ setTimeout(function(){ status.remove(); }, 2000); });
    });
  }

  document.querySelectorAll('[data-sloth]').forEach(attach);

  var ev = new EventSource('/_sloth/stream?group=' + encodeURIComponent(group));
  ev.onmessage = function(e) {
    try {
      var d = JSON.parse(e.data);
      if (d.type === 'reload') { window.location.reload(); return; }
      if (d.text) {
        var p = document.createElement('p');
        p.textContent = d.text;
        container().appendChild(p);
      }
    } catch(err) {}
  };
})();`;

// Parse "alice:pass,bob:pass2" into a map
function parseUsers(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of s.split(',')) {
    const colon = pair.indexOf(':');
    if (colon === -1) continue;
    m.set(pair.slice(0, colon).trim(), pair.slice(colon + 1).trim());
  }
  return m;
}

const PUBLIC_PREFIXES = ['/pub/', '/_sloth/'];

function checkAuth(
  req: http.IncomingMessage,
  users: Map<string, string>,
): boolean {
  if (users.size === 0) return true;
  const url = req.url || '/';
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return true;
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  return users.get(user) === pass;
}

export function startWebProxy(opts: {
  webPort: number;
  vitePort: number;
  slothUsers: string;
  onMessage: OnInboundMessage;
  authSecret?: string;
}): void {
  const { webPort, vitePort, slothUsers, onMessage, authSecret } = opts;
  const users = parseUsers(slothUsers);

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    // Auth check
    if (!checkAuth(req, users)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="sloth"',
        'Content-Type': 'text/plain',
      });
      res.end('Unauthorized');
      return;
    }

    // Public slink endpoints
    if (url === '/pub/sloth.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(PUB_SLOTH_JS);
      return;
    }

    const slinkMatch = url.match(/^\/pub\/s\/([A-Za-z0-9_-]{1,64})$/);
    if (slinkMatch && req.method === 'POST') {
      const token = slinkMatch[1];
      const group = getGroupBySlink(token);
      if (!group) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{"error":"not found"}');
        return;
      }

      // Parse optional JWT
      let sub: string | undefined;
      let senderName: string | undefined;
      const authHeader = req.headers['authorization'] || '';
      if (authHeader.startsWith('Bearer ') && authSecret) {
        const claims = verifyJwt(authHeader.slice(7), authSecret);
        if (claims?.sub) {
          sub = claims.sub;
          senderName = claims.name;
        }
      }

      // Rate limiting
      let rlKey: string;
      let rlLimit: number;
      if (sub) {
        rlKey = `auth:${sub}`;
        rlLimit = SLINK_AUTH_RPM;
      } else {
        rlKey = `anon:${token}`;
        rlLimit = SLINK_ANON_RPM;
      }
      if (isRateLimited(rlKey, rlLimit)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end('{"error":"rate limited"}');
        return;
      }

      // Derive sender
      const ip =
        (req.headers['x-forwarded-for'] as string | undefined)
          ?.split(',')[0]
          .trim() ||
        req.socket.remoteAddress ||
        '';
      const sender =
        sub ??
        `anon_${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 8)}`;

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const { text } = JSON.parse(body) as { text?: string };
          if (!text) throw new Error('missing text');
          const jid = group.jid;
          onMessage(jid, {
            id: `slink-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            chat_jid: jid,
            sender,
            sender_name: senderName ?? sender,
            content: text,
            timestamp: new Date().toISOString(),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"bad request"}');
        }
      });
      return;
    }

    // Sloth endpoints
    if (url === '/_sloth/sloth.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(SLOTH_JS);
      return;
    }

    if (url.startsWith('/_sloth/stream')) {
      const group =
        new URL(url, 'http://localhost').searchParams.get('group') || 'main';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(':\n\n'); // comment keeps connection alive
      addSseListener(group, res);
      req.on('close', () => removeSseListener(group, res));
      return;
    }

    if (url === '/_sloth/message' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          const { group, msg, context, url: pageUrl } = JSON.parse(body);
          const jid = `web:${group || 'main'}`;
          const content = [msg, context, pageUrl]
            .filter(Boolean)
            .join('\n')
            .trim();
          onMessage(jid, {
            id: `web-${Date.now()}`,
            chat_jid: jid,
            sender: 'web',
            sender_name: 'web',
            content,
            timestamp: new Date().toISOString(),
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"ok":false}');
        }
      });
      return;
    }

    // Proxy to Vite, inject sloth.js into HTML responses
    const proxyReq = http.request(
      {
        host: 'localhost',
        port: vitePort,
        path: url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        const ct = proxyRes.headers['content-type'] || '';
        const isHtml = ct.includes('text/html');
        if (!isHtml) {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');
          html = html.replace(
            '</body>',
            '<script src="/_sloth/sloth.js"></script></body>',
          );
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          headers['content-type'] = 'text/html; charset=utf-8';
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(html);
        });
      },
    );
    proxyReq.on('error', (err) => {
      logger.warn({ err }, 'proxy error');
      res.writeHead(502);
      res.end('Bad Gateway');
    });
    req.pipe(proxyReq);
  });

  server.listen(webPort, () => {
    logger.info({ webPort, vitePort }, 'Web proxy started');
  });
}
