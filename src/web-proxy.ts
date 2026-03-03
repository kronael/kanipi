import fs from 'fs';
import http from 'http';
import path from 'path';

import { logger } from './logger.js';
import { addSseListener, removeSseListener } from './channels/web.js';
import type { OnInboundMessage } from './types.js';

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

function checkAuth(
  req: http.IncomingMessage,
  users: Map<string, string>,
  publicPaths: Set<string>,
): boolean {
  if (users.size === 0) return true;
  // Check public path prefixes
  const url = req.url || '/';
  for (const prefix of publicPaths) {
    if (url.startsWith(prefix)) return true;
  }
  const header = req.headers['authorization'] || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const colon = decoded.indexOf(':');
  if (colon === -1) return false;
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  return users.get(user) === pass;
}

function loadPublicPaths(webDir: string): Set<string> {
  const file = path.join(webDir, '_sloth_public.txt');
  const result = new Set<string>();
  try {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      const p = line.trim();
      if (p) result.add(p);
    }
  } catch {}
  return result;
}

export function startWebProxy(opts: {
  webPort: number;
  vitePort: number;
  slothUsers: string;
  webDir: string;
  onMessage: OnInboundMessage;
}): void {
  const { webPort, vitePort, slothUsers, webDir, onMessage } = opts;
  const users = parseUsers(slothUsers);
  let publicPaths = loadPublicPaths(webDir);

  // Reload public paths on change
  try {
    fs.watch(webDir, (_, filename) => {
      if (filename === '_sloth_public.txt')
        publicPaths = loadPublicPaths(webDir);
    });
  } catch {}

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    // Auth check
    if (!checkAuth(req, users, publicPaths)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="sloth"',
        'Content-Type': 'text/plain',
      });
      res.end('Unauthorized');
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
