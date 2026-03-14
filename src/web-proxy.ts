import fs from 'fs';
import http from 'http';
import path from 'path';

import { WEB_DIR } from './config.js';
import {
  checkSessionCookie,
  handleDiscordAuth,
  handleDiscordCallback,
  handleGitHubAuth,
  handleGitHubCallback,
  handleLoginPost,
  handleLogout,
  handleRefresh,
  handleTelegramAuth,
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
  var group = document.currentScript && document.currentScript.dataset.group || 'root';

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
  var group = document.currentScript && document.currentScript.dataset.group || 'root';

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

// --- vhosts.json cache ---
let vhostsCache: Record<string, string> = {};
let vhostsMtime = 0;
let vhostsLastCheck = 0;
const VHOSTS_CHECK_INTERVAL = 5000; // check file mtime every 5s

export function loadVhosts(webDir?: string): Record<string, string> {
  const dir = webDir ?? WEB_DIR;
  const file = path.join(dir, 'vhosts.json');
  const now = Date.now();
  if (now - vhostsLastCheck < VHOSTS_CHECK_INTERVAL) return vhostsCache;
  vhostsLastCheck = now;
  try {
    const stat = fs.statSync(file);
    const mtime = stat.mtimeMs;
    if (mtime === vhostsMtime) return vhostsCache;
    vhostsMtime = mtime;
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      vhostsCache = parsed as Record<string, string>;
      logger.info({ count: Object.keys(vhostsCache).length }, 'vhosts loaded');
    }
  } catch {
    // file missing or invalid — keep previous cache
  }
  return vhostsCache;
}

export function _resetVhosts(): void {
  vhostsCache = {};
  vhostsMtime = 0;
  vhostsLastCheck = 0;
}

const PUBLIC_PREFIXES = ['/pub/', '/_sloth/'];

function checkAuth(req: http.IncomingMessage, authSecret?: string): boolean {
  const url = req.url || '/';
  if (PUBLIC_PREFIXES.some((p) => url.startsWith(p))) return true;
  if (url.startsWith('/auth/')) return true;

  if (authSecret) return checkSessionCookie(req.headers.cookie || '');

  // No auth secret = no auth required
  return true;
}

export function startWebProxy(opts: {
  webPort: number;
  vitePort: number;
  onMessage: OnInboundMessage;
  authSecret?: string;
  webPublic?: boolean;
}): http.Server {
  const { webPort, vitePort, onMessage, authSecret, webPublic } = opts;

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    // Vhost redirect — before auth, public
    const host = req.headers.host?.replace(/:\d+$/, '');
    if (host) {
      const vhosts = loadVhosts();
      const world = vhosts[host];
      if (world) {
        if (url.includes('..')) {
          res.writeHead(400).end();
          return;
        }
        const normalized = path.posix.normalize(url);
        res.writeHead(301, { Location: `/${world}${normalized}` });
        res.end();
        return;
      }
    }

    // Landing page redirects to /pub/ (public, no auth)
    if (!webPublic && (url === '/' || url === '/index.html')) {
      res.writeHead(302, { Location: '/pub/' });
      res.end();
      return;
    }

    // Auth check (skipped in public mode)
    if (!webPublic && !checkAuth(req, authSecret)) {
      res.writeHead(302, { Location: '/auth/login' });
      res.end();
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

    // OAuth routes
    if (url === '/auth/github' && req.method === 'GET') {
      handleGitHubAuth(req, res);
      return;
    }

    if (url.startsWith('/auth/github/callback') && req.method === 'GET') {
      handleGitHubCallback(req, res);
      return;
    }

    if (url === '/auth/discord' && req.method === 'GET') {
      handleDiscordAuth(req, res);
      return;
    }

    if (url.startsWith('/auth/discord/callback') && req.method === 'GET') {
      handleDiscordCallback(req, res);
      return;
    }

    if (url === '/auth/telegram' && req.method === 'POST') {
      handleTelegramAuth(req, res);
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
        new URL(url, 'http://localhost').searchParams.get('group') || 'root';
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
          const jid = `web:${group || 'root'}`;
          const content = [msg, context, pageUrl]
            .filter(Boolean)
            .join('\n')
            .trim();
          onMessage(jid, {
            id: `web-${Date.now()}`,
            chat_jid: jid,
            sender: 'web:anonymous',
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
