import fs from 'fs';
import http from 'http';
import path from 'path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { GROUPS_DIR } from '../config.js';
import { registerDashboard, DashboardContext } from './index.js';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  if (!iso || iso === 'null') return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

function timeAgo(iso: string): string {
  if (!iso || iso === 'null') return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Path safety: only allow posts/*.md patterns
function isPostFile(filename: string): boolean {
  return /^[\w-]+\.md$/.test(filename) && !filename.includes('..');
}

function postsDir(folder: string): string {
  return path.join(GROUPS_DIR, folder, 'posts');
}

interface PostMeta {
  filename: string;
  status: string;
  platforms: string[];
  targets: string[];
  schedule: string;
  strategy: string;
  source: string;
  relevance: number;
  created: string;
  posted: string | null;
  body: string;
}

function listPosts(folder: string): PostMeta[] {
  const dir = postsDir(folder);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const posts: PostMeta[] = [];
  for (const file of files) {
    if (!isPostFile(file)) continue;
    const fp = path.join(dir, file);
    let raw: string;
    try {
      raw = fs.readFileSync(fp, 'utf-8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    posts.push({
      filename: file,
      status: String(fm.status ?? 'draft'),
      platforms: arrayField(fm.platforms),
      targets: arrayField(fm.targets),
      schedule: String(fm.schedule ?? ''),
      strategy: String(fm.strategy ?? ''),
      source: String(fm.source ?? ''),
      relevance: Number(fm.relevance ?? 0),
      created: String(fm.created ?? ''),
      posted:
        fm.posted != null && fm.posted !== 'null' ? String(fm.posted) : null,
      body,
    });
  }

  // newest first
  posts.sort((a, b) => b.created.localeCompare(a.created));
  return posts;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  try {
    return (parseYaml(m[1]) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function arrayField(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v) return [v];
  return [];
}

function setPostStatus(
  folder: string,
  filename: string,
  status: string,
): boolean {
  if (!isPostFile(filename)) return false;
  const fp = path.join(postsDir(folder), filename);
  let raw: string;
  try {
    raw = fs.readFileSync(fp, 'utf-8');
  } catch {
    return false;
  }

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return false;

  let fm: Record<string, unknown>;
  try {
    fm = (parseYaml(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return false;
  }

  fm.status = status;
  if (status === 'posted') {
    fm.posted = new Date().toISOString();
  }

  const body = raw.slice(fmMatch[0].length);
  const newContent = `---\n${stringifyYaml(fm).trimEnd()}\n---\n${body}`;
  try {
    fs.writeFileSync(fp, newContent, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// --- Summary bar ---

interface Counts {
  draft: number;
  approved: number;
  posted: number;
  rejected: number;
  total: number;
}

function countPosts(posts: PostMeta[]): Counts {
  const c: Counts = {
    draft: 0,
    approved: 0,
    posted: 0,
    rejected: 0,
    total: posts.length,
  };
  for (const p of posts) {
    if (p.status === 'draft') c.draft++;
    else if (p.status === 'approved') c.approved++;
    else if (p.status === 'posted') c.posted++;
    else if (p.status === 'rejected') c.rejected++;
  }
  return c;
}

function renderSummary(c: Counts): string {
  const draftStyle = c.draft > 0 ? ' style="color:#f59e0b"' : '';
  return (
    `<table><tr>` +
    `<th>Total</th><th>Drafts</th><th>Approved</th><th>Posted</th><th>Rejected</th>` +
    `</tr><tr>` +
    `<td>${c.total}</td>` +
    `<td${draftStyle}>${c.draft}</td>` +
    `<td style="color:#0066cc">${c.approved}</td>` +
    `<td style="color:#22c55e">${c.posted}</td>` +
    `<td style="color:#9ca3af">${c.rejected}</td>` +
    `</tr></table>`
  );
}

// --- Post row helpers ---

function renderPostRow(
  p: PostMeta,
  group: string,
  showActions: boolean,
): string {
  const src = p.source
    ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.source.slice(0, 60))}</a>`
    : '—';
  const preview = esc(p.body.slice(0, 200)) + (p.body.length > 200 ? '…' : '');
  const platforms = p.platforms.join(', ') || '—';
  const targets = p.targets.join(', ') || '—';

  let actions = '';
  if (showActions) {
    actions =
      `<td>` +
      `<button onclick="approve('${esc(group)}','${esc(p.filename)}')" ` +
      `style="color:#22c55e;cursor:pointer">Approve</button> ` +
      `<button onclick="reject('${esc(group)}','${esc(p.filename)}')" ` +
      `style="color:#9ca3af;cursor:pointer">Reject</button>` +
      `</td>`;
  }

  return (
    `<tr>` +
    `<td><code>${esc(p.filename)}</code></td>` +
    `<td>${src}</td>` +
    `<td>${p.relevance || '—'}</td>` +
    `<td>${esc(p.strategy || '—')}</td>` +
    `<td>${esc(platforms)}</td>` +
    `<td>${esc(targets)}</td>` +
    `<td>${esc(p.schedule || '—')}</td>` +
    `<td><pre style="margin:0;font-size:12px;white-space:pre-wrap;max-width:300px">${preview}</pre></td>` +
    `<td>${fmtDate(p.created)}</td>` +
    actions +
    `</tr>`
  );
}

// --- Section renderers ---

function renderDrafts(posts: PostMeta[], group: string): string {
  const drafts = posts.filter((p) => p.status === 'draft');
  if (drafts.length === 0) return '<p><em>No pending drafts.</em></p>';
  let h =
    '<table><tr>' +
    '<th>File</th><th>Source</th><th>Rel</th><th>Strategy</th>' +
    '<th>Platforms</th><th>Targets</th><th>Schedule</th>' +
    '<th>Preview</th><th>Created</th><th>Actions</th>' +
    '</tr>';
  for (const p of drafts) {
    h += renderPostRow(p, group, true);
  }
  return h + '</table>';
}

function renderScheduled(posts: PostMeta[], group: string): string {
  const approved = posts.filter((p) => p.status === 'approved');
  if (approved.length === 0)
    return '<p><em>No approved posts scheduled.</em></p>';
  let h =
    '<table><tr>' +
    '<th>File</th><th>Source</th><th>Rel</th><th>Strategy</th>' +
    '<th>Platforms</th><th>Targets</th><th>Schedule</th>' +
    '<th>Preview</th><th>Approved</th>' +
    '</tr>';
  for (const p of approved) {
    h += renderPostRow(p, group, false);
  }
  return h + '</table>';
}

function renderHistory(posts: PostMeta[]): string {
  const posted = posts.filter((p) => p.status === 'posted').slice(0, 20);
  if (posted.length === 0) return '<p><em>No posted entries yet.</em></p>';
  let h =
    '<table><tr>' +
    '<th>File</th><th>Source</th><th>Strategy</th>' +
    '<th>Platforms</th><th>Targets</th><th>Posted</th>' +
    '</tr>';
  for (const p of posted) {
    const src = p.source
      ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.source.slice(0, 50))}</a>`
      : '—';
    h +=
      `<tr>` +
      `<td><code>${esc(p.filename)}</code></td>` +
      `<td>${src}</td>` +
      `<td>${esc(p.strategy || '—')}</td>` +
      `<td>${esc(p.platforms.join(', ') || '—')}</td>` +
      `<td>${esc(p.targets.join(', ') || '—')}</td>` +
      `<td>${p.posted ? timeAgo(p.posted) : '—'}</td>` +
      `</tr>`;
  }
  return h + '</table>';
}

// --- API ---

function apiPosts(folder: string): string {
  return JSON.stringify(listPosts(folder));
}

// --- CSS ---

const CSS = `
body { font-family: monospace; max-width: 1100px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; vertical-align: top; }
th { background: #f0f0f0; }
a { color: #0066cc; }
h2 { margin-top: 24px; }
button { background: none; border: 1px solid currentColor; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 12px; }
button:hover { opacity: 0.7; }
`.trim();

// --- Shell HTML ---

const SHELL_HTML = `<!DOCTYPE html>
<html><head><title>Evangelist</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${CSS}</style>
<script>
function getGroup() {
  return new URLSearchParams(window.location.search).get('group') || 'evangelist';
}
function reloadAll() {
  var g = getGroup();
  var q = '?group=' + encodeURIComponent(g);
  htmx.ajax('GET', '/dash/evangelist/x/summary' + q, '#summary-content');
  htmx.ajax('GET', '/dash/evangelist/x/drafts' + q, '#drafts-content');
  htmx.ajax('GET', '/dash/evangelist/x/scheduled' + q, '#scheduled-content');
  htmx.ajax('GET', '/dash/evangelist/x/history' + q, '#history-content');
}
function approve(group, filename) {
  fetch('/dash/evangelist/api/posts/' + encodeURIComponent(filename) + '/approve?group=' + encodeURIComponent(group), {method: 'POST'})
    .then(function(r) { if (r.ok) reloadAll(); else alert('Failed to approve'); });
}
function reject(group, filename) {
  fetch('/dash/evangelist/api/posts/' + encodeURIComponent(filename) + '/reject?group=' + encodeURIComponent(group), {method: 'POST'})
    .then(function(r) { if (r.ok) reloadAll(); else alert('Failed to reject'); });
}
document.addEventListener('DOMContentLoaded', function() { reloadAll(); });
</script>
</head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Evangelist</h1>
<div id="summary-content">Loading...</div>
<h2>Drafts queue</h2>
<div id="drafts-content">Loading...</div>
<h2>Scheduled</h2>
<div id="scheduled-content">Loading...</div>
<h2>Posted history</h2>
<div id="history-content">Loading...</div>
</body></html>`;

// --- Read body helper ---

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

// --- Handler ---

async function evangelistHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  _ctx: DashboardContext,
): Promise<void> {
  const urlObj = new URL(p, 'http://localhost');
  const sub = urlObj.pathname;
  const group = urlObj.searchParams.get('group') || 'evangelist';

  // API: list posts
  if (sub === '/api/posts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(apiPosts(group));
    return;
  }

  // API: approve / reject
  const actionMatch = sub.match(/^\/api\/posts\/([^/]+)\/(approve|reject)$/);
  if (actionMatch && req.method === 'POST') {
    await readBody(req);
    const filename = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2] as 'approve' | 'reject';
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const ok = setPostStatus(group, filename, newStatus);
    if (ok) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"ok":false}');
    }
    return;
  }

  // HTMX fragments
  if (sub === '/x/summary') {
    const posts = listPosts(group);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSummary(countPosts(posts)));
    return;
  }

  if (sub === '/x/drafts') {
    const posts = listPosts(group);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDrafts(posts, group));
    return;
  }

  if (sub === '/x/scheduled') {
    const posts = listPosts(group);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderScheduled(posts, group));
    return;
  }

  if (sub === '/x/history') {
    const posts = listPosts(group);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHistory(posts));
    return;
  }

  // Shell
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHELL_HTML);
}

function evangelistHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  // Check all groups for posts/ dirs
  let totalDrafts = 0;
  let staleDrafts = 0;
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

  let groupsDir: string[];
  try {
    groupsDir = fs.readdirSync(GROUPS_DIR);
  } catch {
    return { status: 'ok', summary: 'no groups' };
  }

  for (const folder of groupsDir) {
    const posts = listPosts(folder);
    const drafts = posts.filter((p) => p.status === 'draft');
    totalDrafts += drafts.length;
    staleDrafts += drafts.filter((p) => p.created && p.created < cutoff).length;
  }

  if (totalDrafts > 10 || staleDrafts > 0) {
    const msg =
      staleDrafts > 0
        ? `${totalDrafts} drafts, ${staleDrafts} stale`
        : `${totalDrafts} drafts pending`;
    return { status: 'warn', summary: msg };
  }
  return { status: 'ok', summary: `${totalDrafts} drafts` };
}

registerDashboard({
  name: 'evangelist',
  title: 'Evangelist',
  description: 'Community engagement draft queue and post history',
  handler: (req, res, p, ctx) => {
    void evangelistHandler(req, res, p, ctx);
  },
  health: evangelistHealth,
});
