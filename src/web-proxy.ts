import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

import { WEB_DIR, WEBDAV_ENABLED, WEBDAV_URL } from './config.js';
import {
  checkSessionCookie,
  getSessionWebdavUser,
  handleDiscordAuth,
  handleDiscordCallback,
  handleGitHubAuth,
  handleGitHubCallback,
  handleGoogleAuth,
  handleGoogleCallback,
  handleLoginPost,
  handleLogout,
  handleRefresh,
  handleTelegramAuth,
  loginPageHtml,
} from './auth.js';
import { getGroupBySlink, getWebdavUser } from './db.js';
import { logger } from './logger.js';
import { handleSlinkPost } from './slink.js';
import { addSseListener, removeSseListener } from './channels/web.js';
import { handleDashRequest, DashboardContext } from './dashboards/index.js';
import './dashboards/tasks.js';
import './dashboards/activity.js';
import './dashboards/groups.js';
import './dashboards/memory.js';
import './dashboards/onboarding.js';
import './dashboards/evangelist.js';
import type { OnInboundMessage } from './types.js';

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

let vhostsCache: Record<string, string> = {};
let vhostsMtime = 0;
let vhostsLastCheck = 0;
const VHOSTS_CHECK_INTERVAL = 5000;

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
  } catch {}
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
  return true;
}

// --- WebDAV proxy ---

const WEBDAV_WRITE_METHODS = new Set([
  'PUT',
  'POST',
  'DELETE',
  'MKCOL',
  'COPY',
  'MOVE',
  'LOCK',
  'UNLOCK',
  'PATCH',
  'PROPPATCH',
]);

// Sensitive file patterns — block writes on these regardless of path.
const WEBDAV_DENY_WRITE_GLOBS = ['.env', '.envrc', '**/*.pem', '.git/**'];

function matchesDenyGlob(filePath: string): boolean {
  const p = filePath.replace(/^\/+/, '');
  for (const glob of WEBDAV_DENY_WRITE_GLOBS) {
    if (glob.startsWith('**/')) {
      const suffix = glob.slice(3);
      if (p === suffix || p.endsWith('/' + suffix)) return true;
    } else if (glob.endsWith('/**')) {
      const prefix = glob.slice(0, -3);
      if (p === prefix || p.startsWith(prefix + '/')) return true;
    } else {
      const parts = p.split('/');
      if (parts[parts.length - 1] === glob) return true;
    }
  }
  return false;
}

function proxyWebdav(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  group: string,
  rest: string,
): void {
  const method = (req.method || 'GET').toUpperCase();
  const isWrite = WEBDAV_WRITE_METHODS.has(method);

  if (isWrite && rest.replace(/^\/+/, '').startsWith('logs/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (isWrite && matchesDenyGlob(rest)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const targetPath = `/${group}${rest}`;
  const upstream = new URL(WEBDAV_URL);
  const upstreamHeaders = { ...req.headers };
  delete upstreamHeaders['authorization'];
  upstreamHeaders['host'] = upstream.host;

  const proxyReq = http.request(
    {
      host: upstream.hostname,
      port: parseInt(upstream.port || '80', 10),
      path: targetPath,
      method: req.method,
      headers: upstreamHeaders,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    logger.warn({ err, group }, 'webdav proxy error');
    res.writeHead(502);
    res.end('Bad Gateway');
  });
  req.pipe(proxyReq);
}

function handleWebdavRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  group: string,
  rest: string,
): void {
  const cookie = req.headers.cookie || '';
  const sessionUser = getSessionWebdavUser(cookie);
  if (sessionUser) {
    let groups: string[] | null = null;
    try {
      const g = JSON.parse(sessionUser.webdav_groups) as string[];
      if (g.length > 0) groups = g;
    } catch {}
    if (groups !== null && !groups.includes(group)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    return proxyWebdav(req, res, group, rest);
  }

  // Basic Auth token flow
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.toLowerCase().startsWith('basic ')) {
    // Browser GET with no auth → redirect to login
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      res.writeHead(302, { Location: '/auth/login' });
      res.end();
      return;
    }
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="kanipi"' });
    res.end('Unauthorized');
    return;
  }

  let username: string;
  let token: string;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString(
      'utf-8',
    );
    const colon = decoded.indexOf(':');
    if (colon === -1) throw new Error('bad format');
    username = decoded.slice(0, colon);
    token = decoded.slice(colon + 1);
  } catch {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="kanipi"' });
    res.end('Unauthorized');
    return;
  }

  const user = getWebdavUser(username);
  if (!user || !user.webdav_token_hash) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="kanipi"' });
    res.end('Unauthorized');
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  if (tokenHash !== user.webdav_token_hash) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="kanipi"' });
    res.end('Unauthorized');
    return;
  }

  let allowedGroups: string[];
  try {
    allowedGroups = JSON.parse(user.webdav_groups) as string[];
  } catch {
    allowedGroups = [];
  }
  if (!allowedGroups.includes(group)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  return proxyWebdav(req, res, group, rest);
}

export function startWebProxy(opts: {
  webPort: number;
  vitePort: number;
  onMessage: OnInboundMessage;
  authSecret?: string;
  webPublic?: boolean;
  dashCtx?: DashboardContext;
}): http.Server {
  const { webPort, vitePort, onMessage, authSecret, webPublic, dashCtx } = opts;

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

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

    if (!webPublic && (url === '/' || url === '/index.html')) {
      res.writeHead(302, { Location: '/pub/' });
      res.end();
      return;
    }

    if (!webPublic && !checkAuth(req, authSecret)) {
      res.writeHead(302, { Location: '/auth/login' });
      res.end();
      return;
    }

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

    if (url === '/auth/github' && req.method === 'GET') {
      handleGitHubAuth(req, res);
      return;
    }

    if (url.startsWith('/auth/github/callback') && req.method === 'GET') {
      handleGitHubCallback(req, res);
      return;
    }

    if (url === '/auth/google' && req.method === 'GET') {
      handleGoogleAuth(req, res);
      return;
    }

    if (url.startsWith('/auth/google/callback') && req.method === 'GET') {
      handleGoogleCallback(req, res);
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

    if (url === '/_sloth/sloth.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(SLOTH_JS);
      return;
    }

    if (url.startsWith('/_sloth/stream')) {
      if (
        !webPublic &&
        authSecret &&
        !checkSessionCookie(req.headers.cookie || '')
      ) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Unauthorized');
        return;
      }
      const group =
        new URL(url, 'http://localhost').searchParams.get('group') || 'root';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(':\n\n');
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

    if (dashCtx && url.startsWith('/dash')) {
      handleDashRequest(req, res, dashCtx);
      return;
    }

    if (url === '/dav' || url === '/dav/') {
      if (!WEBDAV_ENABLED) {
        res.writeHead(404);
        res.end();
        return;
      }
      const cookie = req.headers.cookie || '';
      const sessionUser = getSessionWebdavUser(cookie);
      if (sessionUser) {
        let groups: string[] = [];
        try {
          groups = JSON.parse(sessionUser.webdav_groups) as string[];
        } catch {
          /* */
        }
        const group = groups.length > 0 ? groups[0] : 'root';
        res.writeHead(302, { Location: `/dav/${group}/` });
      } else {
        res.writeHead(302, { Location: '/auth/login' });
      }
      res.end();
      return;
    }

    const davMatch = url.match(/^\/dav\/([^/]+)(\/.*)?$/);
    if (davMatch) {
      if (!WEBDAV_ENABLED) {
        res.writeHead(404);
        res.end();
        return;
      }
      handleWebdavRequest(req, res, davMatch[1], davMatch[2] || '/');
      return;
    }

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
