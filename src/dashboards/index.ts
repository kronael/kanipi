import http from 'http';

import { GroupQueue } from '../group-queue.js';
import { Channel } from '../types.js';
import { getAllGroupConfigs, getAllChats, getAllTasks } from '../db.js';
import { CONTAINER_IMAGE, MAX_CONCURRENT_CONTAINERS } from '../config.js';
import { execSync } from 'child_process';
import { logger } from '../logger.js';

export interface DashboardContext {
  queue: GroupQueue;
  channels: Channel[];
}

interface DashboardEntry {
  name: string;
  title: string;
  description: string;
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    path: string,
    ctx: DashboardContext,
  ) => void;
}

const dashboards: DashboardEntry[] = [];

export function registerDashboard(entry: DashboardEntry): void {
  dashboards.push(entry);
}

export function handleDashRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: DashboardContext,
): boolean {
  const url = req.url || '/';
  if (!url.startsWith('/dash')) return false;

  if (url === '/dash' || url === '/dash/') {
    servePortal(res);
    return true;
  }

  for (const d of dashboards) {
    const prefix = `/dash/${d.name}`;
    if (url === prefix || url.startsWith(prefix + '/')) {
      const sub = url.slice(prefix.length) || '/';
      d.handler(req, res, sub, ctx);
      return true;
    }
  }

  res.writeHead(404);
  res.end('Not found');
  return true;
}

function servePortal(res: http.ServerResponse): void {
  const items = dashboards
    .map(
      (d) =>
        `<li><a href="/dash/${d.name}/">${d.title}</a> &mdash; ${d.description}</li>`,
    )
    .join('\n');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><title>Dashboards</title>
<style>body{font-family:monospace;max-width:600px;margin:40px auto;padding:0 20px}
a{color:#0066cc}</style></head>
<body><h1>Dashboards</h1><ul>${items}</ul></body></html>`);
}

// --- Status dashboard ---

let containerCache: { ts: number; data: ContainerInfo[] } = {
  ts: 0,
  data: [],
};

interface ContainerInfo {
  name: string;
  status: string;
  created: string;
}

function getContainers(): ContainerInfo[] {
  if (Date.now() - containerCache.ts < 5000) return containerCache.data;
  try {
    const raw = execSync(
      `sudo docker ps --filter "ancestor=${CONTAINER_IMAGE}" --format "{{.Names}}\\t{{.Status}}\\t{{.CreatedAt}}"`,
      { stdio: 'pipe', timeout: 3000 },
    ).toString();
    const data = raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, status, created] = line.split('\t');
        return { name, status, created };
      });
    containerCache = { ts: Date.now(), data };
    return data;
  } catch {
    return containerCache.data;
  }
}

function buildState(ctx: DashboardContext) {
  const groups = getAllGroupConfigs();
  const chats = getAllChats();
  const tasks = getAllTasks();
  const containers = getContainers();
  const activeJids = ctx.queue.getActiveJids();
  const queueStatus = ctx.queue.getStatus();

  return {
    uptime_s: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    max_concurrent: MAX_CONCURRENT_CONTAINERS,
    channels: ctx.channels.map((c) => ({ name: c.name })),
    groups: Object.values(groups).map((g) => ({
      name: g.name,
      folder: g.folder,
      active: activeJids.some(
        (jid) =>
          queueStatus.find((s) => s.jid === jid)?.groupFolder === g.folder,
      ),
    })),
    queue: queueStatus,
    containers,
    chats: chats.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      group_folder: t.group_folder,
      schedule: t.schedule_value,
      status: t.status,
    })),
  };
}

function statusHandler(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  ctx: DashboardContext,
): void {
  if (path === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildState(ctx)));
    return;
  }

  // Serve the HTML page for anything else
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(STATUS_HTML);
}

registerDashboard({
  name: 'status',
  title: 'Status & Health',
  description: 'Gateway health, containers, queues, channels',
  handler: statusHandler,
});

const STATUS_HTML = `<!DOCTYPE html>
<html><head><title>Status</title>
<style>
body { font-family: monospace; max-width: 900px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
.ok { color: green; } .warn { color: orange; } .err { color: red; }
h2 { margin-top: 24px; }
a { color: #0066cc; }
#updated { color: #888; font-size: 12px; }
</style></head>
<body>
<h1><a href="/dash/">&larr;</a> Status &amp; Health</h1>
<p id="updated"></p>
<div id="content">Loading...</div>
<script>
function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function render(d) {
  var h = '<h2>Gateway</h2>';
  h += '<table><tr><th>Uptime</th><td>' + fmt(d.uptime_s) + '</td></tr>';
  h += '<tr><th>Memory</th><td>' + d.memory_mb + ' MB</td></tr>';
  h += '<tr><th>Max concurrent</th><td>' + d.max_concurrent + '</td></tr></table>';

  h += '<h2>Channels (' + d.channels.length + ')</h2><table><tr><th>Name</th></tr>';
  d.channels.forEach(function(c) { h += '<tr><td>' + esc(c.name) + '</td></tr>'; });
  h += '</table>';

  h += '<h2>Groups (' + d.groups.length + ')</h2>';
  h += '<table><tr><th>Name</th><th>Folder</th><th>Active</th></tr>';
  d.groups.forEach(function(g) {
    h += '<tr><td>' + esc(g.name) + '</td><td>' + esc(g.folder) + '</td>';
    h += '<td class="' + (g.active ? 'ok' : '') + '">' + (g.active ? 'yes' : '') + '</td></tr>';
  });
  h += '</table>';

  h += '<h2>Containers (' + d.containers.length + ')</h2>';
  h += '<table><tr><th>Name</th><th>Status</th><th>Created</th></tr>';
  d.containers.forEach(function(c) {
    h += '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.status) + '</td>';
    h += '<td>' + esc(c.created) + '</td></tr>';
  });
  h += '</table>';

  h += '<h2>Queue</h2>';
  h += '<table><tr><th>JID</th><th>Active</th><th>Idle</th><th>Pending msgs</th><th>Pending tasks</th><th>Failures</th></tr>';
  d.queue.forEach(function(q) {
    h += '<tr><td>' + esc(q.jid) + '</td>';
    h += '<td class="' + (q.active ? 'ok' : '') + '">' + q.active + '</td>';
    h += '<td>' + q.idleWaiting + '</td>';
    h += '<td>' + q.pendingMessages + '</td>';
    h += '<td>' + q.pendingTasks + '</td>';
    h += '<td class="' + (q.failures > 0 ? 'err' : '') + '">' + q.failures + '</td></tr>';
  });
  h += '</table>';

  h += '<h2>Tasks (' + d.tasks.length + ')</h2>';
  h += '<table><tr><th>ID</th><th>Group</th><th>Schedule</th><th>Status</th></tr>';
  d.tasks.forEach(function(t) {
    h += '<tr><td>' + t.id + '</td><td>' + esc(t.group_folder) + '</td>';
    h += '<td>' + esc(t.schedule) + '</td><td>' + t.status + '</td></tr>';
  });
  h += '</table>';

  h += '<p>' + d.chats + ' chats tracked</p>';
  document.getElementById('content').innerHTML = h;
  document.getElementById('updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}
function fmt(s) {
  var h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h + 'h ' + m + 'm';
}
function load() {
  fetch('/dash/status/api/state').then(function(r) { return r.json(); }).then(render)
    .catch(function(e) { document.getElementById('content').textContent = 'Error: ' + e; });
}
load();
setInterval(load, 10000);
</script>
</body></html>`;
