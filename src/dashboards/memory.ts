import fs from 'fs';
import http from 'http';
import path from 'path';

import { getAllGroupConfigs } from '../db.js';
import { GROUPS_DIR } from '../config.js';
import { registerDashboard, DashboardContext } from './index.js';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(''));
  });
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  return Math.round(bytes / 1024) + 'KB';
}

function fmtMtime(mtime: Date): string {
  return mtime.toISOString().slice(0, 16).replace('T', ' ');
}

// Path safety: only allow known store patterns, no '..' or absolute paths
const ALLOWED_PATTERNS = [
  /^MEMORY\.md$/,
  /^CLAUDE\.md$/,
  /^diary\/[\w-]+\.md$/,
  /^episodes\/[\w-]+\.md$/,
  /^users\/[\w.-]+\.md$/,
  /^facts\/[\w.-]+\.md$/,
];

function isPathAllowed(p: string): boolean {
  if (p.includes('..') || path.isAbsolute(p)) return false;
  return ALLOWED_PATTERNS.some((re) => re.test(p));
}

function resolveGroupFolderPath(folder: string, rel: string): string | null {
  if (!isPathAllowed(rel)) return null;
  return path.join(GROUPS_DIR, folder, rel);
}

function readFileSafe(folder: string, rel: string): string | null {
  const fp = resolveGroupFolderPath(folder, rel);
  if (!fp) return null;
  try {
    return fs.readFileSync(fp, 'utf-8');
  } catch {
    return null;
  }
}

function statFileSafe(folder: string, rel: string): fs.Stats | null {
  const fp = resolveGroupFolderPath(folder, rel);
  if (!fp) return null;
  try {
    return fs.statSync(fp);
  } catch {
    return null;
  }
}

function writeFileSafe(folder: string, rel: string, content: string): boolean {
  const fp = resolveGroupFolderPath(folder, rel);
  if (!fp) return false;
  // Path safety: resolved path must stay inside GROUPS_DIR
  if (!fp.startsWith(path.join(GROUPS_DIR, folder) + path.sep)) return false;
  try {
    fs.writeFileSync(fp, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function listDir(folder: string, sub: string): string[] {
  const dir = path.join(GROUPS_DIR, folder, sub);
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

// Extract first non-empty line from content
function firstLine(content: string): string {
  return (
    content
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('---')) || ''
  );
}

// Extract frontmatter value by key
function fmValue(content: string, key: string): string {
  const m = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : '';
}

// Count knowledge files for a group
function countKnowledge(folder: string): number {
  let n = 0;
  const base = path.join(GROUPS_DIR, folder);
  const check = (rel: string) => {
    if (fs.existsSync(path.join(base, rel))) n++;
  };
  check('MEMORY.md');
  check('CLAUDE.md');
  for (const sub of ['diary', 'episodes', 'users', 'facts']) {
    n += listDir(folder, sub).length;
  }
  return n;
}

// --- Group selector ---

function renderSelector(
  groups: Record<string, { name: string }>,
  selected: string,
): string {
  let opts = '';
  for (const [folder, cfg] of Object.entries(groups)) {
    const sel = folder === selected ? ' selected' : '';
    opts += `<option value="${esc(folder)}"${sel}>${esc(cfg.name)} (${esc(folder)})</option>`;
  }
  return (
    `<form id="group-form">` +
    `<label>Group: <select name="group" onchange="reloadAll(this.value)">${opts}</select></label>` +
    `</form>`
  );
}

// --- MEMORY.md ---

function renderMemory(folder: string): string {
  const content = readFileSafe(folder, 'MEMORY.md');
  if (content === null) return '<p><em>No MEMORY.md found.</em></p>';
  const stat = statFileSafe(folder, 'MEMORY.md');
  const meta = stat
    ? `<span style="color:#888">${fmtSize(stat.size)}, modified ${fmtMtime(stat.mtime)}</span>`
    : '';
  const q = `?group=${encodeURIComponent(folder)}`;
  return (
    `<p>${meta}</p>` +
    `<pre style="background:#f8f8f8;padding:12px;overflow-x:auto;white-space:pre-wrap;max-height:400px;overflow-y:auto">${esc(content)}</pre>` +
    `<button hx-get="/dash/memory/x/edit-memory${q}" hx-target="#memory-content" hx-swap="innerHTML">Edit</button>`
  );
}

function renderEditMemory(folder: string): string {
  const content = readFileSafe(folder, 'MEMORY.md') ?? '';
  const q = `?group=${encodeURIComponent(folder)}`;
  return (
    `<form hx-post="/dash/memory/api/save-memory" hx-target="#memory-content" hx-swap="innerHTML">` +
    `<input type="hidden" name="group" value="${esc(folder)}">` +
    `<textarea name="content" style="width:100%;height:500px;font-family:monospace;box-sizing:border-box">${esc(content)}</textarea>` +
    `<div style="margin-top:8px;display:flex;gap:8px">` +
    `<button type="submit" style="font-family:monospace">Save</button>` +
    `<button type="button" style="font-family:monospace" hx-get="/dash/memory/x/memory${q}" hx-target="#memory-content" hx-swap="innerHTML">Cancel</button>` +
    `</div>` +
    `</form>`
  );
}

// --- CLAUDE.md ---

function renderClaudeMd(folder: string): string {
  const content = readFileSafe(folder, 'CLAUDE.md');
  if (content === null) return '<p><em>No CLAUDE.md found.</em></p>';
  const stat = statFileSafe(folder, 'CLAUDE.md');
  const meta = stat
    ? `<span style="color:#888">${fmtSize(stat.size)}, modified ${fmtMtime(stat.mtime)}</span>`
    : '';
  const q = `?group=${encodeURIComponent(folder)}`;
  return (
    `<details><summary>CLAUDE.md ${meta}</summary>` +
    `<pre style="background:#f8f8f8;padding:12px;overflow-x:auto;white-space:pre-wrap;max-height:400px;overflow-y:auto">${esc(content)}</pre>` +
    `</details>` +
    `<button hx-get="/dash/memory/x/edit-claude${q}" hx-target="#claudemd-content" hx-swap="innerHTML">Edit</button>`
  );
}

function renderEditClaude(folder: string): string {
  const content = readFileSafe(folder, 'CLAUDE.md') ?? '';
  const q = `?group=${encodeURIComponent(folder)}`;
  return (
    `<form hx-post="/dash/memory/api/save-claude" hx-target="#claudemd-content" hx-swap="innerHTML">` +
    `<input type="hidden" name="group" value="${esc(folder)}">` +
    `<textarea name="content" style="width:100%;height:500px;font-family:monospace;box-sizing:border-box">${esc(content)}</textarea>` +
    `<div style="margin-top:8px;display:flex;gap:8px">` +
    `<button type="submit" style="font-family:monospace">Save</button>` +
    `<button type="button" style="font-family:monospace" hx-get="/dash/memory/x/claude-md${q}" hx-target="#claudemd-content" hx-swap="innerHTML">Cancel</button>` +
    `</div>` +
    `</form>`
  );
}

// --- Diary ---

function renderDiary(folder: string): string {
  let files = listDir(folder, 'diary');
  // newest first: diary files are YYYYMMDD.md — sort descending
  files = files.sort().reverse().slice(0, 30);
  if (files.length === 0) return '<p><em>No diary entries.</em></p>';
  let h = '';
  for (const file of files) {
    const content = readFileSafe(folder, `diary/${file}`);
    const summary = content ? firstLine(content) : '';
    const stat = statFileSafe(folder, `diary/${file}`);
    const meta = stat
      ? ` <span style="color:#888">${fmtMtime(stat.mtime)}</span>`
      : '';
    h +=
      `<details><summary>${esc(file.replace(/\.md$/, ''))}${meta} — ${esc(summary.slice(0, 80))}</summary>` +
      `<pre style="background:#f8f8f8;padding:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(content ?? '')}</pre>` +
      `</details>`;
  }
  return h;
}

// --- Episodes ---

const EPISODE_TYPE: [RegExp, string][] = [
  [/^\d{8}\.md$/, 'daily'],
  [/^\d{4}-W\d{2}\.md$/, 'weekly'],
  [/^\d{4}-\d{2}\.md$/, 'monthly'],
];

function episodeType(file: string): string {
  for (const [re, t] of EPISODE_TYPE) {
    if (re.test(file)) return t;
  }
  return 'other';
}

function renderEpisodes(folder: string): string {
  const files = listDir(folder, 'episodes').sort().reverse();
  if (files.length === 0) return '<p><em>No episode files.</em></p>';

  const byType: Record<string, string[]> = {};
  for (const f of files) {
    const t = episodeType(f);
    if (!byType[t]) byType[t] = [];
    byType[t].push(f);
  }

  let h = '';
  for (const t of ['daily', 'weekly', 'monthly', 'other']) {
    const group = byType[t];
    if (!group || group.length === 0) continue;
    h += `<h3 style="margin-top:12px">${t} (${group.length})</h3>`;
    for (const file of group) {
      const content = readFileSafe(folder, `episodes/${file}`);
      const summary = content
        ? fmValue(content, 'summary') || firstLine(content)
        : '';
      const stat = statFileSafe(folder, `episodes/${file}`);
      const meta = stat
        ? ` <span style="color:#888">${fmtSize(stat.size)}</span>`
        : '';
      h +=
        `<details><summary>${esc(file.replace(/\.md$/, ''))}${meta} — ${esc(summary.slice(0, 80))}</summary>` +
        `<pre style="background:#f8f8f8;padding:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(content ?? '')}</pre>` +
        `</details>`;
    }
  }
  return h || '<p><em>No episodes.</em></p>';
}

// --- Users ---

function renderUsers(folder: string): string {
  const files = listDir(folder, 'users').sort();
  if (files.length === 0) return '<p><em>No user context files.</em></p>';
  let h = '';
  for (const file of files) {
    const content = readFileSafe(folder, `users/${file}`);
    const summary = content ? firstLine(content) : '';
    const stat = statFileSafe(folder, `users/${file}`);
    const meta = stat
      ? ` <span style="color:#888">${fmtSize(stat.size)}, ${fmtMtime(stat.mtime)}</span>`
      : '';
    h +=
      `<details><summary>${esc(file.replace(/\.md$/, ''))}${meta} — ${esc(summary.slice(0, 80))}</summary>` +
      `<pre style="background:#f8f8f8;padding:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(content ?? '')}</pre>` +
      `</details>`;
  }
  return h;
}

// --- Facts ---

function renderFacts(folder: string): string {
  const files = listDir(folder, 'facts').sort();
  if (files.length === 0) return '<p><em>No facts.</em></p>';
  let h = '';
  for (const file of files) {
    const content = readFileSafe(folder, `facts/${file}`);
    const summary = content
      ? fmValue(content, 'summary') || firstLine(content)
      : '';
    const stat = statFileSafe(folder, `facts/${file}`);
    const meta = stat
      ? ` <span style="color:#888">${fmtSize(stat.size)}</span>`
      : '';
    h +=
      `<details><summary>${esc(file.replace(/\.md$/, ''))}${meta} — ${esc(summary.slice(0, 80))}</summary>` +
      `<pre style="background:#f8f8f8;padding:10px;white-space:pre-wrap;max-height:300px;overflow-y:auto">${esc(content ?? '')}</pre>` +
      `</details>`;
  }
  return h;
}

// --- Search ---

function storeFiles(folder: string): string[] {
  const stores: string[] = ['MEMORY.md', 'CLAUDE.md'];
  for (const f of listDir(folder, 'diary')) stores.push(`diary/${f}`);
  for (const f of listDir(folder, 'episodes')) stores.push(`episodes/${f}`);
  for (const f of listDir(folder, 'users')) stores.push(`users/${f}`);
  for (const f of listDir(folder, 'facts')) stores.push(`facts/${f}`);
  return stores;
}

function searchMatches(
  folder: string,
  q: string,
): { file: string; line: number; content: string }[] {
  const ql = q.toLowerCase();
  const results: { file: string; line: number; content: string }[] = [];
  for (const rel of storeFiles(folder)) {
    const content = readFileSafe(folder, rel);
    if (!content) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(ql)) {
        results.push({ file: rel, line: i + 1, content: lines[i] });
      }
    }
  }
  return results;
}

function renderSearch(folder: string, q: string): string {
  if (!q) return '<p><em>Enter a search term.</em></p>';

  const matches = searchMatches(folder, q);
  if (matches.length === 0)
    return `<p><em>No results for "${esc(q)}".</em></p>`;

  // Group by file for HTML rendering
  const byFile = new Map<string, { line: number; content: string }[]>();
  for (const m of matches) {
    const g = byFile.get(m.file) ?? [];
    g.push({ line: m.line, content: m.content });
    byFile.set(m.file, g);
  }

  let results = '';
  for (const [rel, lines] of byFile) {
    results += `<h4>${esc(rel)}</h4><table><tr><th>Line</th><th>Content</th></tr>`;
    for (const { line, content } of lines.slice(0, 20)) {
      results += `<tr><td>${line}</td><td>${esc(content.slice(0, 120))}</td></tr>`;
    }
    if (lines.length > 20) {
      results += `<tr><td colspan="2"><em>... ${lines.length - 20} more</em></td></tr>`;
    }
    results += '</table>';
  }

  const total = matches.length;
  return (
    `<p>${total} match${total === 1 ? '' : 'es'} for "${esc(q)}"</p>` + results
  );
}

// --- API: groups list ---

function apiGroups(): string {
  const groups = getAllGroupConfigs();
  const result = Object.entries(groups).map(([folder, cfg]) => ({
    folder,
    name: cfg.name,
    knowledge_files: countKnowledge(folder),
  }));
  return JSON.stringify(result);
}

// --- API: file tree ---

interface FileEntry {
  path: string;
  size: number;
  modified: string;
  summary?: string;
  type?: string;
}

function apiFiles(folder: string): string {
  const base = path.join(GROUPS_DIR, folder);

  function statEntry(rel: string): FileEntry | null {
    const fp = path.join(base, rel);
    try {
      const s = fs.statSync(fp);
      return { path: rel, size: s.size, modified: s.mtime.toISOString() };
    } catch {
      return null;
    }
  }

  const memory = statEntry('MEMORY.md');
  const claude_md = statEntry('CLAUDE.md');

  const diary: FileEntry[] = [];
  for (const f of listDir(folder, 'diary')) {
    const e = statEntry(`diary/${f}`);
    if (!e) continue;
    const content = readFileSafe(folder, `diary/${f}`);
    e.summary = content ? firstLine(content).slice(0, 80) : '';
    diary.push(e);
  }
  diary.sort((a, b) => b.path.localeCompare(a.path));

  const episodes: FileEntry[] = [];
  for (const f of listDir(folder, 'episodes')) {
    const e = statEntry(`episodes/${f}`);
    if (!e) continue;
    e.type = episodeType(f);
    episodes.push(e);
  }

  const users: FileEntry[] = [];
  for (const f of listDir(folder, 'users')) {
    const e = statEntry(`users/${f}`);
    if (e) users.push(e);
  }

  const facts: FileEntry[] = [];
  for (const f of listDir(folder, 'facts')) {
    const e = statEntry(`facts/${f}`);
    if (!e) continue;
    const content = readFileSafe(folder, `facts/${f}`);
    e.summary = content
      ? fmValue(content, 'summary') || firstLine(content).slice(0, 80)
      : '';
    facts.push(e);
  }

  return JSON.stringify({
    group: folder,
    memory,
    claude_md,
    diary,
    episodes,
    users,
    facts,
  });
}

// --- API: search ---

function apiSearch(folder: string, q: string): string {
  if (!q) return JSON.stringify([]);
  return JSON.stringify(
    searchMatches(folder, q).map((m) => ({
      ...m,
      content: m.content.slice(0, 200),
    })),
  );
}

// --- CSS ---

const CSS = `
body { font-family: monospace; max-width: 900px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
a { color: #0066cc; }
h2 { margin-top: 24px; }
h3 { margin-top: 16px; }
details { margin: 4px 0; }
details summary { cursor: pointer; padding: 4px 0; }
details summary:hover { color: #0066cc; }
input[type=text] { font-family: monospace; width: 400px; padding: 4px; }
`.trim();

// --- Shell HTML ---

const SHELL_HTML = `<!DOCTYPE html>
<html><head><title>Memory &amp; Knowledge</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${CSS}</style>
<script>
function reloadAll(group) {
  var params = '?group=' + encodeURIComponent(group);
  htmx.ajax('GET', '/dash/memory/x/memory' + params, '#memory-content');
  htmx.ajax('GET', '/dash/memory/x/claude-md' + params, '#claudemd-content');
  htmx.ajax('GET', '/dash/memory/x/diary' + params, '#diary-content');
  htmx.ajax('GET', '/dash/memory/x/episodes' + params, '#episodes-content');
  htmx.ajax('GET', '/dash/memory/x/users' + params, '#users-content');
  htmx.ajax('GET', '/dash/memory/x/facts' + params, '#facts-content');
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-group').value = group;
}
function doSearch(e) {
  e.preventDefault();
  var group = document.getElementById('search-group').value;
  var q = document.getElementById('search-q').value;
  htmx.ajax('GET', '/dash/memory/x/search?group=' + encodeURIComponent(group) + '&q=' + encodeURIComponent(q), '#search-results');
}
</script>
</head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Memory &amp; Knowledge</h1>
<div id="selector" hx-get="/dash/memory/x/selector" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>MEMORY.md</h2>
<div id="memory-content" hx-get="/dash/memory/x/memory" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>CLAUDE.md</h2>
<div id="claudemd-content" hx-get="/dash/memory/x/claude-md" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>Diary</h2>
<div id="diary-content" hx-get="/dash/memory/x/diary" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>Episodes</h2>
<div id="episodes-content" hx-get="/dash/memory/x/episodes" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>User Context</h2>
<div id="users-content" hx-get="/dash/memory/x/users" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>Facts</h2>
<div id="facts-content" hx-get="/dash/memory/x/facts" hx-trigger="load" hx-swap="innerHTML">Loading...</div>
<h2>Search</h2>
<form onsubmit="doSearch(event)">
  <input type="hidden" id="search-group" value="">
  <input type="text" id="search-q" placeholder="Search all knowledge stores..." />
  <button type="submit">Search</button>
</form>
<div id="search-results"></div>
</body></html>`;

// --- Handler ---

async function memoryHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  _ctx: DashboardContext,
): Promise<void> {
  const urlObj = new URL(p, 'http://localhost');
  const sub = urlObj.pathname;

  // API endpoints
  if (sub === '/api/groups') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(apiGroups());
    return;
  }

  if (sub === '/api/files') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(apiFiles(folder));
    return;
  }

  if (sub === '/api/file') {
    const folder = urlObj.searchParams.get('group') ?? '';
    const rel = urlObj.searchParams.get('path') ?? '';
    const content = readFileSafe(folder, rel);
    if (content === null) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(content);
    return;
  }

  if (sub === '/api/search') {
    const folder = urlObj.searchParams.get('group') ?? '';
    const q = urlObj.searchParams.get('q') ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(apiSearch(folder, q));
    return;
  }

  // HTMX fragments
  if (sub === '/x/selector') {
    const groups = getAllGroupConfigs();
    const folders = Object.keys(groups);
    const selected = urlObj.searchParams.get('group') || folders[0] || '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSelector(groups, selected));
    return;
  }

  if (sub === '/x/memory') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMemory(folder));
    return;
  }

  if (sub === '/x/claude-md') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderClaudeMd(folder));
    return;
  }

  if (sub === '/x/diary') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDiary(folder));
    return;
  }

  if (sub === '/x/diary-entry') {
    const folder = urlObj.searchParams.get('group') ?? '';
    const file = urlObj.searchParams.get('file') ?? '';
    const content = readFileSafe(folder, `diary/${file}`);
    if (content === null) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<pre style="background:#f8f8f8;padding:10px;white-space:pre-wrap">${esc(content)}</pre>`,
    );
    return;
  }

  if (sub === '/x/episodes') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderEpisodes(folder));
    return;
  }

  if (sub === '/x/users') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderUsers(folder));
    return;
  }

  if (sub === '/x/facts') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderFacts(folder));
    return;
  }

  if (sub === '/x/file') {
    const folder = urlObj.searchParams.get('group') ?? '';
    const rel = urlObj.searchParams.get('path') ?? '';
    const content = readFileSafe(folder, rel);
    if (content === null) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<pre style="background:#f8f8f8;padding:10px;white-space:pre-wrap">${esc(content)}</pre>`,
    );
    return;
  }

  if (sub === '/x/search') {
    const folder = urlObj.searchParams.get('group') ?? '';
    const q = urlObj.searchParams.get('q') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSearch(folder, q));
    return;
  }

  if (sub === '/x/edit-memory') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderEditMemory(folder));
    return;
  }

  if (sub === '/x/edit-claude') {
    const folder = urlObj.searchParams.get('group') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderEditClaude(folder));
    return;
  }

  if (sub === '/api/save-memory' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const folder = params.get('group') ?? '';
    const content = params.get('content') ?? '';
    const ok = writeFileSafe(folder, 'MEMORY.md', content);
    if (!ok) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Write failed');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderMemory(folder));
    return;
  }

  if (sub === '/api/save-claude' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const folder = params.get('group') ?? '';
    const content = params.get('content') ?? '';
    const ok = writeFileSafe(folder, 'CLAUDE.md', content);
    if (!ok) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Write failed');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderClaudeMd(folder));
    return;
  }

  // Shell
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHELL_HTML);
}

function memoryHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  const groups = getAllGroupConfigs();
  const folders = Object.keys(groups);
  let total = 0;
  for (const folder of folders) {
    total += countKnowledge(folder);
  }
  return {
    status: 'ok',
    summary: `${folders.length} groups, ${total} knowledge files`,
  };
}

registerDashboard({
  name: 'memory',
  title: 'Memory & Knowledge',
  description: 'MEMORY.md, diary, episodes, facts, and user context per group',
  handler: (req, res, p, ctx) => {
    void memoryHandler(req, res, p, ctx);
  },
  health: memoryHealth,
});
