import http from 'http';

import { GroupQueue } from '../group-queue.js';
import { Channel } from '../types.js';
import { getAllGroupConfigs, getAllChats, getAllTasks } from '../db.js';
import { CONTAINER_IMAGE, MAX_CONCURRENT_CONTAINERS } from '../config.js';
import { execSync } from 'child_process';

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
): void {
  const url = req.url || '/';

  if (url === '/dash' || url === '/dash/') {
    servePortal(res);
    return;
  }

  for (const d of dashboards) {
    const prefix = `/dash/${d.name}`;
    if (url === prefix || url.startsWith(prefix + '/')) {
      d.handler(req, res, url.slice(prefix.length) || '/', ctx);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
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

// --- container cache ---

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

// --- state builder ---

function buildState(ctx: DashboardContext) {
  const groups = getAllGroupConfigs();
  const tasks = getAllTasks();
  const containers = getContainers();
  const queueStatus = ctx.queue.getStatus();
  const activeFolders = new Set(
    queueStatus
      .filter((s) => s.active && s.groupFolder)
      .map((s) => s.groupFolder),
  );

  return {
    uptime_s: Math.round(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    max_concurrent: MAX_CONCURRENT_CONTAINERS,
    channels: ctx.channels.map((c) => ({ name: c.name })),
    groups: Object.values(groups).map((g) => ({
      name: g.name,
      folder: g.folder,
      active: activeFolders.has(g.folder),
    })),
    queue: queueStatus,
    containers,
    chats: getAllChats().length,
    tasks: tasks.map((t) => ({
      id: t.id,
      group_folder: t.group_folder,
      schedule: t.schedule_value,
      status: t.status,
    })),
  };
}

// --- html helpers ---

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h + 'h ' + m + 'm';
}

// --- fragment renderers ---

function renderGateway(d: ReturnType<typeof buildState>): string {
  return (
    '<table>' +
    `<tr><th>Uptime</th><td>${fmtUptime(d.uptime_s)}</td></tr>` +
    `<tr><th>Memory</th><td>${d.memory_mb} MB</td></tr>` +
    `<tr><th>Max concurrent</th><td>${d.max_concurrent}</td></tr>` +
    '</table>'
  );
}

function renderChannels(d: ReturnType<typeof buildState>): string {
  let h = `<h3>${d.channels.length} channels</h3>`;
  h += '<table><tr><th>Name</th></tr>';
  for (const c of d.channels) {
    h += `<tr><td>${esc(c.name)}</td></tr>`;
  }
  return h + '</table>';
}

function renderGroups(d: ReturnType<typeof buildState>): string {
  let h = `<h3>${d.groups.length} groups</h3>`;
  h += '<table><tr><th>Name</th><th>Folder</th><th>Active</th></tr>';
  for (const g of d.groups) {
    const cls = g.active ? ' class="ok"' : '';
    h +=
      `<tr><td>${esc(g.name)}</td><td>${esc(g.folder)}</td>` +
      `<td${cls}>${g.active ? 'yes' : ''}</td></tr>`;
  }
  return h + '</table>';
}

function renderContainers(d: ReturnType<typeof buildState>): string {
  let h = `<h3>${d.containers.length} containers</h3>`;
  h += '<table><tr><th>Name</th><th>Status</th><th>Created</th></tr>';
  for (const c of d.containers) {
    h +=
      `<tr><td>${esc(c.name)}</td><td>${esc(c.status)}</td>` +
      `<td>${esc(c.created)}</td></tr>`;
  }
  return h + '</table>';
}

function renderQueue(d: ReturnType<typeof buildState>): string {
  let h =
    '<table><tr><th>JID</th><th>Active</th><th>Idle</th>' +
    '<th>Pending msgs</th><th>Pending tasks</th>' +
    '<th>Failures</th></tr>';
  for (const q of d.queue) {
    const aCls = q.active ? ' class="ok"' : '';
    const fCls = q.failures > 0 ? ' class="err"' : '';
    h +=
      `<tr><td>${esc(q.jid)}</td>` +
      `<td${aCls}>${q.active}</td>` +
      `<td>${q.idleWaiting}</td>` +
      `<td>${q.pendingMessages}</td>` +
      `<td>${q.pendingTasks}</td>` +
      `<td${fCls}>${q.failures}</td></tr>`;
  }
  return h + '</table>';
}

function renderTasks(d: ReturnType<typeof buildState>): string {
  let h = `<h3>${d.tasks.length} tasks</h3>`;
  h +=
    '<table><tr><th>ID</th><th>Group</th>' +
    '<th>Schedule</th><th>Status</th></tr>';
  for (const t of d.tasks) {
    h +=
      `<tr><td>${t.id}</td><td>${esc(t.group_folder)}</td>` +
      `<td>${esc(t.schedule)}</td><td>${t.status}</td></tr>`;
  }
  return h + '</table>';
}

function renderSummary(d: ReturnType<typeof buildState>): string {
  const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
  return (
    `<p>${d.chats} chats tracked</p>` + `<p id="updated">Updated: ${now}</p>`
  );
}

type FragmentRenderer = (d: ReturnType<typeof buildState>) => string;

const fragments: Record<string, FragmentRenderer> = {
  gateway: renderGateway,
  channels: renderChannels,
  groups: renderGroups,
  containers: renderContainers,
  queue: renderQueue,
  tasks: renderTasks,
  summary: renderSummary,
};

// --- status handler ---

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

  const xMatch = path.match(/^\/x\/(\w+)$/);
  if (xMatch) {
    const name = xMatch[1];
    const renderer = fragments[name];
    if (!renderer) {
      res.writeHead(404);
      res.end('Unknown fragment');
      return;
    }
    const d = buildState(ctx);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderer(d));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(STATUS_HTML);
}

registerDashboard({
  name: 'status',
  title: 'Status & Health',
  description: 'Gateway health, containers, queues, channels',
  handler: statusHandler,
});

// --- shell html ---

const SECTIONS = [
  'gateway',
  'channels',
  'groups',
  'containers',
  'queue',
  'tasks',
  'summary',
] as const;

function buildSectionDivs(): string {
  const titles: Record<string, string> = {
    gateway: 'Gateway',
    channels: 'Channels',
    groups: 'Groups',
    containers: 'Containers',
    queue: 'Queue',
    tasks: 'Tasks',
    summary: '',
  };
  return SECTIONS.map((s) => {
    const hdr = titles[s] ? `<h2>${titles[s]}</h2>` : '';
    return (
      hdr +
      '<div' +
      ` hx-get="/dash/status/x/${s}"` +
      ' hx-trigger="load, every 10s"' +
      ' hx-swap="innerHTML"' +
      '>Loading...</div>'
    );
  }).join('\n');
}

const STATUS_HTML = `<!DOCTYPE html>
<html><head><title>Status</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
body { font-family: monospace; max-width: 900px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
.ok { color: green; } .err { color: red; }
h2 { margin-top: 24px; }
a { color: #0066cc; }
#updated { color: #888; font-size: 12px; }
</style></head>
<body>
<h1><a href="/dash/">&larr;</a> Status &amp; Health</h1>
${buildSectionDivs()}
</body></html>`;
