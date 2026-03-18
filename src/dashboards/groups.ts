import fs from 'fs';
import http from 'http';
import path from 'path';

import { getAllGroupConfigs, getAllRoutes } from '../db.js';
import { GROUPS_DIR, permissionTier } from '../config.js';
import { registerDashboard, DashboardContext } from './index.js';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countFiles(dir: string): number {
  try {
    if (!fs.existsSync(dir)) return 0;
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

function knowledgeCounts(folder: string): Record<string, number> {
  const base = path.join(GROUPS_DIR, folder);
  return {
    facts: countFiles(path.join(base, 'facts')),
    episodes: countFiles(path.join(base, 'episodes')),
    diary: countFiles(path.join(base, 'diary')),
    users: countFiles(path.join(base, 'users')),
    memory: fs.existsSync(path.join(base, 'MEMORY.md')) ? 1 : 0,
  };
}

function getActiveSet(ctx: DashboardContext): Set<string | null> {
  return new Set(
    ctx.queue
      .getStatus()
      .filter((s) => s.active)
      .map((s) => s.groupFolder),
  );
}

function worldOf(folder: string): string {
  const parts = folder.split('/');
  return parts[0] ?? folder;
}

function renderSummary(ctx: DashboardContext): string {
  const groups = getAllGroupConfigs();
  const folders = Object.keys(groups);
  const worlds = new Set(folders.map(worldOf)).size;
  const active = getActiveSet(ctx);
  const activeCount = folders.filter((f) => active.has(f)).length;
  return (
    `<table><tr><th>Total groups</th><th>Worlds</th><th>Active</th></tr>` +
    `<tr><td>${folders.length}</td><td>${worlds}</td>` +
    `<td style="${activeCount > 0 ? 'color:#22c55e' : ''}">${activeCount}</td></tr></table>`
  );
}

function renderTree(ctx: DashboardContext): string {
  const groups = getAllGroupConfigs();
  const folders = Object.keys(groups).sort();
  const active = getActiveSet(ctx);

  const byWorld: Record<string, string[]> = {};
  for (const f of folders) {
    const w = worldOf(f);
    if (!byWorld[w]) byWorld[w] = [];
    byWorld[w].push(f);
  }

  let h = '';
  for (const [w, fs_] of Object.entries(byWorld)) {
    h += `<div style="margin-bottom:12px"><strong>${esc(w)}</strong>`;
    for (const f of fs_) {
      const depth = f.split('/').length - 1;
      const tier = permissionTier(f);
      const isActive = active.has(f);
      const tierBadge = `<span style="color:#9ca3af;font-size:11px"> t${tier}</span>`;
      const activeDot = isActive
        ? ' <span style="color:#22c55e">&#9679;</span>'
        : '';
      const indent = '&nbsp;'.repeat(depth * 4);
      const cfg = groups[f];
      const name = cfg ? esc(cfg.name) : esc(f);
      h +=
        `<div style="padding-left:${depth * 16}px">` +
        `${indent}<a href="/dash/groups/x/detail?folder=${encodeURIComponent(f)}" ` +
        `hx-get="/dash/groups/x/detail?folder=${encodeURIComponent(f)}" ` +
        `hx-target="#detail" hx-swap="innerHTML">` +
        `${name}</a> <span style="color:#9ca3af">${esc(f)}</span>` +
        `${tierBadge}${activeDot}` +
        `</div>`;
    }
    h += '</div>';
  }
  return h || '<p><em>No groups.</em></p>';
}

function renderDetail(folder: string): string {
  const groups = getAllGroupConfigs();
  const cfg = groups[folder];
  if (!cfg) return '<p><em>Group not found.</em></p>';

  const routes = getAllRoutes().filter(
    (r) => r.target === folder || r.target.startsWith(folder + '/'),
  );
  const kc = knowledgeCounts(folder);
  const tier = permissionTier(folder);

  let h =
    `<h3>${esc(cfg.name)} <span style="color:#9ca3af">(${esc(folder)})</span></h3>` +
    `<table>` +
    `<tr><th>Folder</th><td>${esc(folder)}</td></tr>` +
    `<tr><th>Added</th><td>${esc(cfg.added_at.slice(0, 10))}</td></tr>` +
    `<tr><th>Tier</th><td>${tier}</td></tr>`;
  if (cfg.parent) h += `<tr><th>Parent</th><td>${esc(cfg.parent)}</td></tr>`;
  if (cfg.maxChildren)
    h += `<tr><th>Max children</th><td>${cfg.maxChildren}</td></tr>`;
  h += '</table>';

  h += '<h4>Knowledge</h4>';
  h +=
    '<table><tr><th>facts</th><th>episodes</th><th>diary</th><th>users</th><th>MEMORY.md</th></tr>';
  h += `<tr><td>${kc.facts}</td><td>${kc.episodes}</td><td>${kc.diary}</td><td>${kc.users}</td><td>${kc.memory ? 'yes' : 'no'}</td></tr>`;
  h += '</table>';

  if (routes.length > 0) {
    h += '<h4>Routes targeting this group</h4>';
    h +=
      '<table><tr><th>JID</th><th>Type</th><th>Match</th><th>Target</th></tr>';
    for (const r of routes) {
      h +=
        `<tr>` +
        `<td>${esc(r.jid)}</td>` +
        `<td>${esc(r.type)}</td>` +
        `<td>${r.match ? esc(r.match) : '—'}</td>` +
        `<td>${esc(r.target)}</td>` +
        `</tr>`;
    }
    h += '</table>';
  }
  return h;
}

function renderRoutes(): string {
  const routes = getAllRoutes();
  if (routes.length === 0) return '<p><em>No routes configured.</em></p>';

  const byJid: Record<string, typeof routes> = {};
  for (const r of routes) {
    if (!byJid[r.jid]) byJid[r.jid] = [];
    byJid[r.jid].push(r);
  }

  let h = '';
  for (const [jid, rs] of Object.entries(byJid)) {
    h += `<h3>${esc(jid)}</h3>`;
    h +=
      '<table><tr><th>Seq</th><th>Type</th><th>Match</th><th>Target</th></tr>';
    for (const r of rs) {
      const typeColor =
        r.type === 'command'
          ? '#0066cc'
          : r.type === 'pattern' || r.type === 'keyword'
            ? '#7c3aed'
            : r.type === 'sender'
              ? '#d97706'
              : '#6b7280';
      const isTemplate = r.target.includes('{');
      h +=
        `<tr>` +
        `<td>${r.seq}</td>` +
        `<td style="color:${typeColor}">${esc(r.type)}</td>` +
        `<td>${r.match ? esc(r.match) : '—'}</td>` +
        `<td>${esc(r.target)}${isTemplate ? ' <em style="color:#9ca3af">\u27e8template\u27e9</em>' : ''}</td>` +
        `</tr>`;
    }
    h += '</table>';
  }
  return h;
}

function renderWorlds(ctx: DashboardContext): string {
  const groups = getAllGroupConfigs();
  const folders = Object.keys(groups).sort();
  const active = getActiveSet(ctx);

  const byWorld: Record<string, string[]> = {};
  for (const f of folders) {
    const w = worldOf(f);
    if (!byWorld[w]) byWorld[w] = [];
    byWorld[w].push(f);
  }

  if (Object.keys(byWorld).length === 0) return '<p><em>No groups.</em></p>';

  let h =
    '<table><tr><th>World</th><th>Groups</th><th>Active</th><th>Tiers</th></tr>';
  for (const [w, fs_] of Object.entries(byWorld)) {
    const actCount = fs_.filter((f) => active.has(f)).length;
    const tiers = [...new Set(fs_.map((f) => permissionTier(f)))]
      .sort()
      .join(', ');
    h +=
      `<tr>` +
      `<td><strong>${esc(w)}</strong></td>` +
      `<td>${fs_.length}</td>` +
      `<td${actCount > 0 ? ' style="color:#22c55e"' : ''}>${actCount}</td>` +
      `<td>${tiers}</td>` +
      `</tr>`;
  }
  return h + '</table>';
}

const CSS = `
body { font-family: monospace; max-width: 900px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
a { color: #0066cc; }
h2 { margin-top: 24px; }
h3 { margin-top: 16px; }
`.trim();

const SHELL_HTML = `<!DOCTYPE html>
<html><head><title>Groups &amp; Routing</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${CSS}</style></head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Groups &amp; Routing</h1>
<h2>Summary</h2>
<div hx-get="/dash/groups/x/summary" hx-trigger="load, every 30s" hx-swap="innerHTML">Loading...</div>
<h2>Group Tree</h2>
<div hx-get="/dash/groups/x/tree" hx-trigger="load, every 30s" hx-swap="innerHTML">Loading...</div>
<div id="detail"></div>
<h2>Worlds</h2>
<div hx-get="/dash/groups/x/worlds" hx-trigger="load, every 60s" hx-swap="innerHTML">Loading...</div>
<h2>Routes</h2>
<div hx-get="/dash/groups/x/routes" hx-trigger="load, every 60s" hx-swap="innerHTML">Loading...</div>
</body></html>`;

function groupsHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  ctx: DashboardContext,
): void {
  const urlObj = new URL(p, 'http://localhost');
  const sub = urlObj.pathname;

  if (sub === '/x/summary') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSummary(ctx));
    return;
  }
  if (sub === '/x/tree') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderTree(ctx));
    return;
  }
  if (sub === '/x/detail') {
    const folder = urlObj.searchParams.get('folder') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDetail(folder));
    return;
  }
  if (sub === '/x/routes') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderRoutes());
    return;
  }
  if (sub === '/x/worlds') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderWorlds(ctx));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHELL_HTML);
}

function groupsHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  const groups = getAllGroupConfigs();
  const folders = Object.keys(groups);
  const worlds = new Set(folders.map(worldOf)).size;
  return {
    status: 'ok',
    summary: `${folders.length} groups, ${worlds} worlds`,
  };
}

registerDashboard({
  name: 'groups',
  title: 'Groups & Routing',
  description: 'Group tree, worlds, and route table',
  handler: groupsHandler,
  health: groupsHealth,
});
