import http from 'http';

import {
  checkSessionCookie,
  handleLoginPost,
  handleLogout,
  handleRefresh,
  loginPageHtml,
} from './auth.js';
import { getGroupBySlink } from './db.js';
import { logger } from './logger.js';
import { handleSlinkPost } from './slink.js';
import { addSseListener, removeSseListener } from './channels/web.js';
import type { OnInboundMessage } from './types.js';

// Public sloth client — same as internal; served unauthenticated at /pub/sloth.js
// Token is read from data-token on the script tag; posts to /pub/s/<token> with JWT from localStorage
const PUB_SLOTH_JS = `(function(){
  var token = document.currentScript && document.currentScript.dataset.token || '';
  var group = document.currentScript && document.currentScript.dataset.group || 'main';

  function jwt() {
    try { return localStorage.getItem('sloth_jwt') || ''; } catch(e) { return ''; }
  }

  function post(msg, ctx, url) {
    var headers = {'Content-Type': 'application/json'};
    var t = jwt();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    var endpoint = token ? '/pub/s/' + token : '/_sloth/message';
    var body = token
      ? JSON.stringify({text: msg})
      : JSON.stringify({group: group, msg: msg, context: ctx, url: url});
    return fetch(endpoint, {method: 'POST', headers: headers, body: body});
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
      status.textContent = ' \u2026';
      el.appendChild(status);
      post(msg, el.dataset.slothContext || '', window.location.href)
        .then(function(r){ status.textContent = r.ok ? ' \u2713' : ' \u2717'; })
        .catch(function(){ status.textContent = ' \u2717'; })
        .finally(function(){ setTimeout(function(){ status.remove(); }, 2000); });
    });
  }

  document.querySelectorAll('[data-sloth]').forEach(attach);
})()`;

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
  authSecret?: string,
): boolean {
  const url = req.url || '/';
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return true;
  if (url.startsWith('/auth/')) return true;

  if (authSecret) return checkSessionCookie(req.headers.cookie || '');

  if (users.size === 0) return true;
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
}): http.Server {
  const { webPort, vitePort, slothUsers, onMessage, authSecret } = opts;
  const users = parseUsers(slothUsers);

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    // Landing page redirects to /pub/ (public, no auth)
    if (url === '/' || url === '/index.html') {
      res.writeHead(302, { Location: '/pub/' });
      res.end();
      return;
    }

    // Auth check
    if (!checkAuth(req, users, authSecret)) {
      if (authSecret) {
        res.writeHead(302, { Location: '/auth/login' });
        res.end();
      } else {
        res.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="sloth"',
          'Content-Type': 'text/plain',
        });
        res.end('Unauthorized');
      }
      return;
    }

    // Session auth routes
    if (url === '/auth/login' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(loginPageHtml());
      return;
    }

    if (url === '/auth/login' && req.method === 'POST') {
      if (!authSecret) {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        const result = await handleLoginPost(body, authSecret);
        res.writeHead(
          result.status,
          result.headers || { 'Content-Type': 'application/json' },
        );
        res.end(result.body);
      });
      return;
    }

    if (url === '/auth/refresh' && req.method === 'POST') {
      if (!authSecret) {
        res.writeHead(404);
        res.end();
        return;
      }
      const result = handleRefresh(req.headers.cookie || '', authSecret);
      res.writeHead(
        result.status,
        result.headers || { 'Content-Type': 'application/json' },
      );
      res.end(result.body);
      return;
    }

    if (url === '/auth/logout' && req.method === 'POST') {
      handleLogout(req.headers.cookie || '');
      res.writeHead(302, {
        'Set-Cookie': 'refresh=; HttpOnly; Path=/; Max-Age=0',
        Location: '/auth/login',
      });
      res.end();
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
      const ip =
        (req.headers['x-forwarded-for'] as string | undefined)
          ?.split(',')[0]
          .trim() ||
        req.socket.remoteAddress ||
        '';
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const result = handleSlinkPost({
          token,
          body,
          ip,
          authHeader: req.headers['authorization'],
          authSecret,
          group: group ?? undefined,
          onMessage,
        });
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
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
  return server;
}
