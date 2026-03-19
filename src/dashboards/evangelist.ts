import fs from 'fs';
import http from 'http';
import path from 'path';

import { parse as parseYaml } from 'yaml';

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

// Path safety: only allow simple *.md filenames
function isSafeFilename(filename: string): boolean {
  return /^[\w-]+\.md$/.test(filename) && !filename.includes('..');
}

function narrativesDir(folder: string): string {
  return path.join(GROUPS_DIR, folder, 'narratives');
}

type PipelineDir = 'drafts' | 'approved' | 'scheduled' | 'posted' | 'rejected';
const PIPELINE_DIRS: PipelineDir[] = [
  'drafts',
  'approved',
  'scheduled',
  'posted',
  'rejected',
];

function postsSubDir(folder: string, dir: PipelineDir): string {
  return path.join(GROUPS_DIR, folder, 'posts', dir);
}

interface PostMeta {
  filename: string;
  dir: PipelineDir;
  platforms: string[];
  targets: string[];
  schedule: string;
  strategy: string;
  source: string;
  relevance: number;
  created: string;
  posted: string | null;
  body: string;
  content_id: string;
}

function listDir(folder: string, dir: PipelineDir): PostMeta[] {
  const dirPath = postsSubDir(folder, dir);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const posts: PostMeta[] = [];
  for (const file of files) {
    if (!isSafeFilename(file)) continue;
    const fp = path.join(dirPath, file);
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
      dir,
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
      content_id: String(fm.content_id ?? ''),
    });
  }

  // newest first
  posts.sort((a, b) => b.created.localeCompare(a.created));
  return posts;
}

function listPosts(folder: string): PostMeta[] {
  return PIPELINE_DIRS.flatMap((dir) => listDir(folder, dir));
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

function movePost(
  folder: string,
  filename: string,
  from: PipelineDir,
  to: PipelineDir,
): boolean {
  if (!isSafeFilename(filename)) return false;
  const src = path.join(postsSubDir(folder, from), filename);
  const dst = path.join(postsSubDir(folder, to), filename);
  try {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return true;
  } catch {
    return false;
  }
}

// --- Marker-based discovery ---

export function findEvangelistGroups(
  groupsDir: string,
): { folder: string; dir: string }[] {
  const results: { folder: string; dir: string }[] = [];

  function scan(base: string, prefix: string): void {
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(base, entry);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      const folder = prefix ? `${prefix}/${entry}` : entry;
      const marker = path.join(full, '.evangelist');
      if (fs.existsSync(marker)) {
        results.push({ folder, dir: full });
      }
      scan(full, folder);
    }
  }

  scan(groupsDir, '');
  return results;
}

// --- Tweet vs post card mode ---

export function isTweetMode(p: PostMeta): boolean {
  const onlyTwitter =
    p.platforms.length > 0 && p.platforms.every((pl) => pl === 'twitter');
  return onlyTwitter || p.body.length < 300;
}

// --- Summary bar ---

interface Counts {
  drafts: number;
  approved: number;
  scheduled: number;
  posted: number;
  rejected: number;
}

function countPosts(folder: string): Counts {
  return {
    drafts: listDir(folder, 'drafts').length,
    approved: listDir(folder, 'approved').length,
    scheduled: listDir(folder, 'scheduled').length,
    posted: listDir(folder, 'posted').length,
    rejected: listDir(folder, 'rejected').length,
  };
}

function renderSummary(c: Counts): string {
  const draftStyle = c.drafts > 0 ? ' style="color:#f59e0b"' : '';
  return (
    `<table><tr>` +
    `<th>Drafts</th><th>Approved</th><th>Scheduled</th><th>Posted</th><th>Rejected</th>` +
    `</tr><tr>` +
    `<td${draftStyle}>${c.drafts}</td>` +
    `<td style="color:#0066cc">${c.approved}</td>` +
    `<td style="color:#a855f7">${c.scheduled}</td>` +
    `<td style="color:#22c55e">${c.posted}</td>` +
    `<td style="color:#9ca3af">${c.rejected}</td>` +
    `</tr></table>`
  );
}

// --- Post row helpers ---

function platformBadge(platforms: string[]): string {
  const colors: Record<string, string> = {
    twitter: '#1da1f2',
    bluesky: '#0085ff',
    reddit: '#ff4500',
    linkedin: '#0a66c2',
    mastodon: '#6364ff',
  };
  return platforms
    .map((pl) => {
      const col = colors[pl.toLowerCase()] ?? '#888';
      return `<span style="background:${col};color:#fff;padding:1px 5px;border-radius:3px;font-size:11px">${esc(pl)}</span>`;
    })
    .join(' ');
}

function renderTweetCard(p: PostMeta, group: string): string {
  const preview = esc(p.body.slice(0, 120)) + (p.body.length > 120 ? '…' : '');
  const badge = platformBadge(p.platforms);
  const actions =
    `<button onclick="approve('${esc(group)}','${esc(p.filename)}')" ` +
    `style="color:#22c55e;cursor:pointer">Approve</button> ` +
    `<button onclick="reject('${esc(group)}','${esc(p.filename)}')" ` +
    `style="color:#9ca3af;cursor:pointer">Reject</button>`;
  return (
    `<div class="tweet-card">` +
    `<span class="badges">${badge}</span> ` +
    `<span class="tweet-preview">${preview}</span> ` +
    `<span class="tweet-actions">${actions}</span>` +
    `</div>`
  );
}

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

// Group posts by content_id for cluster display
function groupByContentId(posts: PostMeta[]): Array<PostMeta | PostMeta[]> {
  const idGroups = new Map<string, PostMeta[]>();

  for (const p of posts) {
    if (p.content_id) {
      const g = idGroups.get(p.content_id) ?? [];
      g.push(p);
      idGroups.set(p.content_id, g);
    }
  }

  const result: Array<PostMeta | PostMeta[]> = [];
  for (const p of posts) {
    if (!p.content_id) {
      result.push(p);
    } else if (idGroups.has(p.content_id)) {
      const grp = idGroups.get(p.content_id)!;
      result.push(grp);
      idGroups.delete(p.content_id);
    }
  }

  return result;
}

// --- Section renderers ---

function renderDrafts(folder: string, group: string): string {
  const drafts = listDir(folder, 'drafts');
  if (drafts.length === 0) return '<p><em>No pending drafts.</em></p>';

  const grouped = groupByContentId(drafts);
  const tableHeader =
    '<table><tr>' +
    '<th>File</th><th>Source</th><th>Rel</th><th>Strategy</th>' +
    '<th>Platforms</th><th>Targets</th><th>Schedule</th>' +
    '<th>Preview</th><th>Created</th><th>Actions</th>' +
    '</tr>';

  let tableRows = '';
  let tweetCards = '';
  let hasTable = false;

  for (const item of grouped) {
    const posts = Array.isArray(item) ? item : [item];

    if (Array.isArray(item)) {
      // content_id cluster — wrap in a visual group
      const clusterRows = posts
        .map((p) => renderPostRow(p, group, true))
        .join('');
      tableRows += `<tr><td colspan="10" style="background:#f9f9f9;font-size:11px;color:#888;padding:2px 8px">content cluster: ${esc(posts[0].content_id)}</td></tr>${clusterRows}`;
      hasTable = true;
    } else {
      const p = item;
      if (isTweetMode(p)) {
        tweetCards += renderTweetCard(p, group);
      } else {
        tableRows += renderPostRow(p, group, true);
        hasTable = true;
      }
    }
  }

  let out = '';
  if (tweetCards) {
    out += `<div class="tweet-list">${tweetCards}</div>`;
  }
  if (hasTable) {
    out += tableHeader + tableRows + '</table>';
  }
  return out;
}

function renderScheduled(folder: string): string {
  const approved = listDir(folder, 'approved');
  if (approved.length === 0)
    return '<p><em>No approved posts scheduled.</em></p>';
  let h =
    '<table><tr>' +
    '<th>File</th><th>Source</th><th>Rel</th><th>Strategy</th>' +
    '<th>Platforms</th><th>Targets</th><th>Schedule</th>' +
    '<th>Preview</th><th>Approved</th>' +
    '</tr>';
  for (const p of approved) {
    h += renderPostRow(p, '', false);
  }
  return h + '</table>';
}

function renderHistory(folder: string): string {
  const posted = listDir(folder, 'posted').slice(0, 20);
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

// --- Calendar view ---

// Returns 'YYYY-MM-DD' if iso-like, else null
function parseIsoDate(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function groupByScheduleDate(
  posts: PostMeta[],
): Map<string, PostMeta[]> {
  const dated = new Map<string, PostMeta[]>();
  const unscheduled: PostMeta[] = [];

  for (const p of posts) {
    const d = parseIsoDate(p.schedule);
    if (d) {
      const g = dated.get(d) ?? [];
      g.push(p);
      dated.set(d, g);
    } else {
      unscheduled.push(p);
    }
  }

  const result = new Map<string, PostMeta[]>(
    [...dated.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
  if (unscheduled.length > 0) result.set('Unscheduled', unscheduled);
  return result;
}

function renderCalendar(folder: string): string {
  const posts = [
    ...listDir(folder, 'approved'),
    ...listDir(folder, 'scheduled'),
  ];
  if (posts.length === 0)
    return '<p><em>No approved or scheduled posts.</em></p>';

  const grouped = groupByScheduleDate(posts);
  let h = '<dl>';
  for (const [date, datePosts] of grouped) {
    h += `<dt style="font-weight:bold;margin-top:12px">${esc(date)}</dt>`;
    for (const p of datePosts) {
      const badge = platformBadge(p.platforms);
      const target = p.targets[0] ? ` → ${esc(p.targets[0])}` : '';
      const first = esc(p.body.split('\n').find((l) => l.trim()) ?? '');
      h += `<dd style="margin:4px 0 4px 16px">${badge}${target} — ${first}</dd>`;
    }
  }
  return h + '</dl>';
}

// --- Knowledge tab ---

function renderKnowledge(folder: string): string {
  const factsDir = path.join(GROUPS_DIR, folder, 'facts');
  const files = ['sources.md', 'product.md'];
  let h = '';
  for (const file of files) {
    const fp = path.join(factsDir, file);
    let content: string;
    try {
      content = fs.readFileSync(fp, 'utf-8');
    } catch {
      content = '(not found)';
    }
    h +=
      `<h3>${esc(file)}</h3>` +
      `<pre style="background:#f9f9f9;border:1px solid #ddd;padding:8px;` +
      `white-space:pre-wrap;font-size:12px;max-width:860px">${esc(content)}</pre>`;
  }
  return h;
}

// --- Narratives ---

interface NarrativeMeta {
  filename: string;
  title: string;
  tags: string[];
  excerpt: string;
  raw: string;
}

function listNarratives(folder: string): NarrativeMeta[] {
  const dir = narrativesDir(folder);
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const result: NarrativeMeta[] = [];
  for (const file of files) {
    if (!isSafeFilename(file)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    result.push({
      filename: file,
      title: String(fm.title ?? file.replace(/\.md$/, '')),
      tags: arrayField(fm.tags),
      excerpt: body.slice(0, 160) + (body.length > 160 ? '…' : ''),
      raw,
    });
  }
  return result;
}

function renderNarrativesList(folder: string): string {
  const narratives = listNarratives(folder);
  const q = `?group=${encodeURIComponent(folder)}`;
  let h =
    `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">` +
    `<strong>${narratives.length} narrative(s)</strong>` +
    `<button hx-get="/dash/evangelist/x/narrative-edit${q}&file=" ` +
    `hx-target="#narratives-content" hx-swap="innerHTML">New narrative</button>` +
    `</div>`;
  if (narratives.length === 0) {
    h += '<p><em>No narratives yet.</em></p>';
    return h;
  }
  for (const n of narratives) {
    const tags = n.tags.length
      ? n.tags
          .map(
            (t) =>
              `<span style="background:#e5e7eb;padding:1px 5px;border-radius:3px;font-size:11px">${esc(t)}</span>`,
          )
          .join(' ')
      : '';
    h +=
      `<div style="border:1px solid #ddd;border-radius:4px;padding:8px 12px;margin:6px 0;cursor:pointer" ` +
      `hx-get="/dash/evangelist/x/narrative-edit${q}&file=${encodeURIComponent(n.filename)}" ` +
      `hx-target="#narratives-content" hx-swap="innerHTML">` +
      `<div style="display:flex;justify-content:space-between;align-items:baseline">` +
      `<strong>${esc(n.title)}</strong>` +
      `<code style="font-size:11px;color:#9ca3af">${esc(n.filename)}</code>` +
      `</div>` +
      (tags ? `<div style="margin:3px 0">${tags}</div>` : '') +
      `<div style="color:#6b7280;font-size:12px">${esc(n.excerpt)}</div>` +
      `</div>`;
  }
  return h;
}

function renderNarrativeEditor(folder: string, filename: string): string {
  const q = `?group=${encodeURIComponent(folder)}`;
  const isNew = !filename;
  let raw = '';
  let title = '';
  if (!isNew) {
    const fp = path.join(narrativesDir(folder), filename);
    try {
      raw = fs.readFileSync(fp, 'utf-8');
      const fm = parseFrontmatter(raw);
      title = String(fm.title ?? filename.replace(/\.md$/, ''));
    } catch {
      raw = '';
    }
  }
  const saveUrl = isNew
    ? '/dash/evangelist/api/narratives/new'
    : '/dash/evangelist/api/narratives/save';
  const fileInput = isNew
    ? ''
    : `<input type="hidden" name="file" value="${esc(filename)}">`;
  return (
    `<div>` +
    `<h3 style="margin:0 0 8px">${isNew ? 'New narrative' : `Edit: ${esc(title)}`}</h3>` +
    `<form hx-post="${saveUrl}" hx-target="#narratives-content" hx-swap="innerHTML">` +
    `<input type="hidden" name="group" value="${esc(folder)}">` +
    fileInput +
    `<textarea name="content" rows="20" ` +
    `style="font-family:monospace;width:100%;box-sizing:border-box;height:400px;` +
    `border:1px solid #ccc;padding:8px;resize:vertical">${esc(raw)}</textarea>` +
    `<div style="display:flex;gap:8px;margin-top:8px">` +
    `<button type="submit">Save</button>` +
    `<button type="button" ` +
    `hx-get="/dash/evangelist/x/narratives${q}" ` +
    `hx-target="#narratives-content" hx-swap="innerHTML">Cancel</button>` +
    `</div>` +
    `</form>` +
    `</div>`
  );
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
.tweet-list { margin: 10px 0; }
.tweet-card { display: flex; align-items: baseline; gap: 8px; padding: 5px 8px; border: 1px solid #e5e7eb; border-radius: 4px; margin: 4px 0; flex-wrap: wrap; }
.tweet-preview { flex: 1; min-width: 200px; }
.tweet-actions { white-space: nowrap; }
.badges { white-space: nowrap; }
.tabs { display: flex; gap: 0; margin: 16px 0 0; border-bottom: 2px solid #ccc; }
.tab { padding: 6px 16px; cursor: pointer; border: 1px solid #ccc; border-bottom: none; background: #f0f0f0; font-family: monospace; font-size: 13px; }
.tab.active { background: #fff; border-bottom: 2px solid #fff; margin-bottom: -2px; }
.tab-panel { display: none; padding: 12px 0; }
.tab-panel.active { display: block; }
`.trim();

// --- Group selector ---

function buildGroupSelector(
  groups: { folder: string }[],
  selected: string,
): string {
  if (groups.length <= 1) return '';
  let opts = groups
    .map(
      (g) =>
        `<option value="${esc(g.folder)}"${g.folder === selected ? ' selected' : ''}>${esc(g.folder)}</option>`,
    )
    .join('');
  return (
    `<form style="margin:8px 0">` +
    `<label>Group: <select name="group" onchange="window.location.search='?group='+encodeURIComponent(this.value)">${opts}</select></label>` +
    `</form>`
  );
}

// --- Shell HTML ---

function buildShell(
  groups: { folder: string }[],
  selectedGroup: string,
): string {
  const selector = buildGroupSelector(groups, selectedGroup);
  const q = `?group=${encodeURIComponent(selectedGroup)}`;
  return `<!DOCTYPE html>
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
function showTab(name) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById('tab-btn-' + name).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}
document.addEventListener('DOMContentLoaded', function() { reloadAll(); showTab('drafts'); });
</script>
</head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Evangelist</h1>
${selector}
<div id="summary-content">Loading...</div>
<div class="tabs">
  <button class="tab" id="tab-btn-drafts" onclick="showTab('drafts')">Drafts</button>
  <button class="tab" id="tab-btn-scheduled" onclick="showTab('scheduled')">Approved</button>
  <button class="tab" id="tab-btn-calendar" onclick="showTab('calendar');htmx.ajax('GET','/dash/evangelist/x/calendar${q}','#calendar-content')">Calendar</button>
  <button class="tab" id="tab-btn-history" onclick="showTab('history')">Posted</button>
  <button class="tab" id="tab-btn-knowledge" onclick="showTab('knowledge');htmx.ajax('GET','/dash/evangelist/x/knowledge${q}','#knowledge-content')">Knowledge</button>
  <button class="tab" id="tab-btn-narratives" onclick="showTab('narratives');htmx.ajax('GET','/dash/evangelist/x/narratives${q}','#narratives-content')">Narratives</button>
</div>
<div id="tab-drafts" class="tab-panel">
  <div id="drafts-content">Loading...</div>
</div>
<div id="tab-scheduled" class="tab-panel">
  <div id="scheduled-content">Loading...</div>
</div>
<div id="tab-calendar" class="tab-panel">
  <div id="calendar-content">Loading...</div>
</div>
<div id="tab-history" class="tab-panel">
  <div id="history-content">Loading...</div>
</div>
<div id="tab-knowledge" class="tab-panel">
  <div id="knowledge-content">Loading...</div>
</div>
<div id="tab-narratives" class="tab-panel">
  <div id="narratives-content">Loading...</div>
</div>
</body></html>`;
}

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

  // API: approve / reject (move from drafts/ to approved/ or rejected/)
  const actionMatch = sub.match(/^\/api\/posts\/([^/]+)\/(approve|reject)$/);
  if (actionMatch && req.method === 'POST') {
    await readBody(req);
    const filename = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2] as 'approve' | 'reject';
    const to: PipelineDir = action === 'approve' ? 'approved' : 'rejected';
    const ok = movePost(group, filename, 'drafts', to);
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
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSummary(countPosts(group)));
    return;
  }

  if (sub === '/x/drafts') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDrafts(group, group));
    return;
  }

  if (sub === '/x/scheduled') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderScheduled(group));
    return;
  }

  if (sub === '/x/history') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHistory(group));
    return;
  }

  if (sub === '/x/calendar') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderCalendar(group));
    return;
  }

  if (sub === '/x/knowledge') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderKnowledge(group));
    return;
  }

  if (sub === '/x/narratives') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderNarrativesList(group));
    return;
  }

  if (sub === '/x/narrative-edit') {
    const file = urlObj.searchParams.get('file') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderNarrativeEditor(group, file));
    return;
  }

  // API: save existing narrative
  if (sub === '/api/narratives/save' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const grp = params.get('group') ?? group;
    const file = params.get('file') ?? '';
    const content = params.get('content') ?? '';
    if (!isSafeFilename(file)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename');
      return;
    }
    const dir = narrativesDir(grp);
    const fp = path.join(dir, file);
    // Path safety: resolved path must stay inside narrativesDir
    if (!fp.startsWith(dir + path.sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Path error');
      return;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, content, 'utf-8');
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Write failed');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderNarrativesList(grp));
    return;
  }

  // API: create new narrative
  if (sub === '/api/narratives/new' && req.method === 'POST') {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const grp = params.get('group') ?? group;
    const content = params.get('content') ?? '';
    // Derive filename from title frontmatter, fall back to timestamp
    const fm = parseFrontmatter(content);
    const titleRaw = String(fm.title ?? '');
    const slug = titleRaw
      ? titleRaw
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
      : `narrative-${Date.now()}`;
    const file = `${slug}.md`;
    if (!isSafeFilename(file)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid filename derived from title');
      return;
    }
    const dir = narrativesDir(grp);
    const fp = path.join(dir, file);
    if (!fp.startsWith(dir + path.sep)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Path error');
      return;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fp, content, 'utf-8');
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Write failed');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderNarrativesList(grp));
    return;
  }

  // Shell — discover groups with .evangelist marker
  const discovered = findEvangelistGroups(GROUPS_DIR);
  const shell = buildShell(discovered, group);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(shell);
}

function evangelistHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  // Check evangelist-marked groups for posts/drafts/ dirs
  let totalDrafts = 0;
  let staleDrafts = 0;
  const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

  let discovered: { folder: string }[];
  try {
    discovered = findEvangelistGroups(GROUPS_DIR);
  } catch {
    return { status: 'ok', summary: 'no groups' };
  }

  if (discovered.length === 0) return { status: 'ok', summary: 'no groups' };

  for (const { folder } of discovered) {
    const drafts = listDir(folder, 'drafts');
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
