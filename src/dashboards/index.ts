import fs from 'fs';
import http from 'http';
import path from 'path';

import { parse as parseYaml } from 'yaml';

import { GroupQueue } from '../group-queue.js';
import { Channel } from '../types.js';
import { getAllGroupConfigs, getAllChats, getAllTasks } from '../db.js';
import {
  CONTAINER_IMAGE,
  MAX_CONCURRENT_CONTAINERS,
  GROUPS_DIR,
} from '../config.js';
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
  health?: (ctx: DashboardContext) => {
    status: 'ok' | 'warn' | 'error';
    summary: string;
  };
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

  // Tile fragment endpoint for portal auto-refresh
  const tileMatch = url.match(/^\/dash\/portal\/tile\/([^/?]+)$/);
  if (tileMatch) {
    const name = tileMatch[1];
    const d = dashboards.find((x) => x.name === name);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderTile(d, ctx));
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

function renderTile(
  d: DashboardEntry | undefined,
  ctx: DashboardContext,
): string {
  if (!d) return '<div class="tile"><span>Not found</span></div>';
  let dot = 'dot-none';
  let summary = esc(d.description);
  if (d.health) {
    try {
      const h = d.health(ctx);
      dot =
        h.status === 'ok'
          ? 'dot-ok'
          : h.status === 'warn'
            ? 'dot-warn'
            : 'dot-err';
      summary = esc(h.summary);
    } catch {
      dot = 'dot-err';
      summary = 'health check failed';
    }
  }
  return (
    `<a class="tile" href="/dash/${esc(d.name)}/">` +
    `<div class="tile-header"><span class="dot ${dot}"></span>` +
    `<span class="tile-title">${esc(d.title)}</span></div>` +
    `<div class="tile-summary">${summary}</div>` +
    `</a>`
  );
}

const PORTAL_CSS = `
body { font-family: monospace; max-width: 900px; margin: 20px auto; padding: 0 20px; }
h1 { margin-bottom: 12px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.tile { display: block; border: 1px solid #ccc; padding: 12px 16px; text-decoration: none; color: inherit; border-radius: 4px; }
.tile:hover { border-color: #999; background: #fafafa; }
.tile-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.dot-ok { background: #22c55e; }
.dot-warn { background: #f59e0b; }
.dot-err { background: #ef4444; }
.dot-none { background: #9ca3af; }
.tile-title { font-weight: bold; font-size: 15px; }
.tile-summary { color: #555; font-size: 13px; }
`.trim();

function servePortal(res: http.ServerResponse): void {
  const tileDivs = dashboards
    .map(
      (d) =>
        `<div hx-get="/dash/portal/tile/${d.name}" hx-trigger="load, every 30s" hx-swap="outerHTML">` +
        `<a class="tile" href="/dash/${esc(d.name)}/">` +
        `<div class="tile-header"><span class="dot dot-none"></span>` +
        `<span class="tile-title">${esc(d.title)}</span></div>` +
        `<div class="tile-summary">${esc(d.description)}</div>` +
        `</a></div>`,
    )
    .join('\n');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html><head><title>Dashboards</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${PORTAL_CSS}</style></head>
<body>
<h1>Dashboards</h1>
<div class="tiles">${tileDivs}</div>
</body></html>`);
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

// --- memory dashboard ---

interface FactEntry {
  group: string;
  filename: string;
  verified_at: string;
  question: string;
  answer: string;
}

interface EpisodeDashEntry {
  group: string;
  type: string;
  key: string;
  summary: string;
}

interface MemoryEntry {
  group: string;
  content: string;
}

function parseFrontmatterMemory(content: string): Record<string, string> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    const fm = parseYaml(m[1]);
    const out: Record<string, string> = {};
    for (const k of Object.keys(fm ?? {})) {
      const v = fm[k];
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function readMemoryState(): {
  facts: FactEntry[];
  episodes: EpisodeDashEntry[];
  memories: MemoryEntry[];
} {
  const groups = getAllGroupConfigs();
  const facts: FactEntry[] = [];
  const episodes: EpisodeDashEntry[] = [];
  const memories: MemoryEntry[] = [];

  for (const [folder, cfg] of Object.entries(groups)) {
    const groupDir = path.join(GROUPS_DIR, folder);

    // facts
    const factsDir = path.join(groupDir, 'facts');
    if (fs.existsSync(factsDir)) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(factsDir).filter((f) => f.endsWith('.md'));
      } catch {
        // skip
      }
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(factsDir, file), 'utf-8');
          const fm = parseFrontmatterMemory(content);
          const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
          const firstAnswerLine =
            (fm.answer || body).split('\n').find((l) => l.trim()) || '';
          facts.push({
            group: cfg.name,
            filename: file,
            verified_at: fm.verified_at || '',
            question: fm.question || fm.topic || file.replace(/\.md$/, ''),
            answer: firstAnswerLine.slice(0, 120),
          });
        } catch {
          // skip
        }
      }
    }

    // episodes
    const episodesDir = path.join(groupDir, 'episodes');
    if (fs.existsSync(episodesDir)) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(episodesDir).filter((f) => f.endsWith('.md'));
      } catch {
        // skip
      }
      const EPISODE_PATTERNS: [RegExp, string][] = [
        [/^\d{8}\.md$/, 'day'],
        [/^\d{4}-W\d{2}\.md$/, 'week'],
        [/^\d{4}-\d{2}\.md$/, 'month'],
      ];
      for (const file of files) {
        let type = '';
        for (const [re, t] of EPISODE_PATTERNS) {
          if (re.test(file)) {
            type = t;
            break;
          }
        }
        if (!type) continue;
        try {
          const content = fs.readFileSync(
            path.join(episodesDir, file),
            'utf-8',
          );
          const fm = parseFrontmatterMemory(content);
          if (fm.summary) {
            episodes.push({
              group: cfg.name,
              type: fm.type || type,
              key: file.replace(/\.md$/, ''),
              summary: fm.summary,
            });
          }
        } catch {
          // skip
        }
      }
    }

    // MEMORY.md
    const memPath = path.join(groupDir, 'MEMORY.md');
    if (fs.existsSync(memPath)) {
      try {
        const content = fs.readFileSync(memPath, 'utf-8');
        memories.push({ group: cfg.name, content });
      } catch {
        // skip
      }
    }
  }

  facts.sort((a, b) => b.verified_at.localeCompare(a.verified_at));
  return { facts, episodes, memories };
}

function renderFacts(facts: FactEntry[]): string {
  if (facts.length === 0) return '<p><em>No facts found.</em></p>';
  let h = `<h2>Facts (${facts.length})</h2>`;
  h +=
    '<table><tr><th>Group</th><th>File</th><th>Verified</th><th>Question / Topic</th><th>Answer (first line)</th></tr>';
  for (const f of facts) {
    h +=
      `<tr><td>${esc(f.group)}</td><td>${esc(f.filename)}</td>` +
      `<td>${esc(f.verified_at)}</td><td>${esc(f.question)}</td>` +
      `<td>${esc(f.answer)}</td></tr>`;
  }
  return h + '</table>';
}

function renderEpisodes(episodes: EpisodeDashEntry[]): string {
  if (episodes.length === 0) return '<p><em>No episodes found.</em></p>';
  let h = `<h2>Episodes (${episodes.length})</h2>`;
  h +=
    '<table><tr><th>Group</th><th>Type</th><th>Key</th><th>Summary</th></tr>';
  for (const e of episodes) {
    h +=
      `<tr><td>${esc(e.group)}</td><td>${esc(e.type)}</td>` +
      `<td>${esc(e.key)}</td><td>${esc(e.summary)}</td></tr>`;
  }
  return h + '</table>';
}

function renderMemories(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '<p><em>No MEMORY.md files found.</em></p>';
  let h = `<h2>MEMORY.md (${memories.length} groups)</h2>`;
  for (const m of memories) {
    h += `<h3>${esc(m.group)}</h3><pre>${esc(m.content)}</pre>`;
  }
  return h;
}

const MEMORY_HTML = `<!DOCTYPE html>
<html><head><title>Memory &amp; Knowledge</title>
<style>
body { font-family: monospace; max-width: 1100px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
h2 { margin-top: 28px; }
h3 { margin-top: 16px; color: #333; }
pre { background: #f8f8f8; padding: 12px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; }
a { color: #0066cc; }
</style></head>
<body>
<h1><a href="/dash/">&larr;</a> Memory &amp; Knowledge</h1>
<div id="facts"></div>
<div id="episodes"></div>
<div id="memories"></div>
<script>
async function load(id, url) {
  const r = await fetch(url);
  document.getElementById(id).innerHTML = await r.text();
}
load('facts', '/dash/memory/x/facts');
load('episodes', '/dash/memory/x/episodes');
load('memories', '/dash/memory/x/memories');
</script>
</body></html>`;

function memoryHandler(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  path_: string,
  _ctx: DashboardContext,
): void {
  const xMatch = path_.match(/^\/x\/(\w+)$/);
  if (xMatch) {
    const name = xMatch[1];
    const state = readMemoryState();
    let html: string;
    if (name === 'facts') html = renderFacts(state.facts);
    else if (name === 'episodes') html = renderEpisodes(state.episodes);
    else if (name === 'memories') html = renderMemories(state.memories);
    else {
      res.writeHead(404);
      res.end('Unknown fragment');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(MEMORY_HTML);
}

registerDashboard({
  name: 'memory',
  title: 'Memory & Knowledge',
  description: 'Facts, episodes, and MEMORY.md per group',
  handler: memoryHandler,
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
