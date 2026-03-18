import http from 'http';

import { getRecentMessages, getAllChats, getAllRoutes } from '../db.js';
import { registerDashboard, DashboardContext } from './index.js';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ago(timestamp: string): string {
  const diff = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function renderSummary(): string {
  const msgs = getRecentMessages(1000);
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const recent = msgs.filter((m) => m.timestamp >= cutoff);
  const chats = new Set(recent.map((m) => m.chat_jid)).size;
  const senders = new Set(recent.map((m) => m.sender).filter(Boolean)).size;

  const byGroup: Record<string, number> = {};
  for (const m of recent) {
    const g = m.group_folder ?? 'unknown';
    byGroup[g] = (byGroup[g] ?? 0) + 1;
  }

  let h =
    `<table><tr>` +
    `<th>Messages (24h)</th><th>Unique chats</th><th>Unique senders</th>` +
    `</tr><tr>` +
    `<td>${recent.length}</td><td>${chats}</td><td>${senders}</td>` +
    `</tr></table>`;

  if (Object.keys(byGroup).length > 0) {
    h += '<table><tr><th>Group</th><th>Messages</th></tr>';
    for (const [g, n] of Object.entries(byGroup).sort((a, b) => b[1] - a[1])) {
      h += `<tr><td>${esc(g)}</td><td>${n}</td></tr>`;
    }
    h += '</table>';
  }
  return h;
}

function renderRecent(chatFilter: string): string {
  const msgs = getRecentMessages(50);
  const filtered = chatFilter
    ? msgs.filter((m) => m.chat_jid === chatFilter)
    : msgs;
  if (filtered.length === 0) return '<p><em>No recent messages.</em></p>';
  let h =
    '<table><tr><th>When</th><th>Chat</th><th>Sender</th><th>Text</th></tr>';
  for (const m of filtered) {
    const text = (m.content ?? '').slice(0, 80);
    h +=
      `<tr>` +
      `<td>${ago(m.timestamp)}</td>` +
      `<td>${esc(m.chat_jid)}</td>` +
      `<td>${esc(m.sender_name ?? m.sender ?? '')}</td>` +
      `<td>${esc(text)}</td>` +
      `</tr>`;
  }
  return h + '</table>';
}

function renderChats(): string {
  const chats = getAllChats();
  const msgs = getRecentMessages(1000);
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const countByChat: Record<string, number> = {};
  for (const m of msgs) {
    if (m.timestamp >= cutoff) {
      countByChat[m.chat_jid] = (countByChat[m.chat_jid] ?? 0) + 1;
    }
  }
  const active = chats.filter((c) => countByChat[c.jid]);
  if (active.length === 0)
    return '<p><em>No active chats in last 24h.</em></p>';
  active.sort((a, b) => (countByChat[b.jid] ?? 0) - (countByChat[a.jid] ?? 0));
  let h =
    '<table><tr><th>Chat</th><th>Name</th><th>Messages (24h)</th><th>Last message</th></tr>';
  for (const c of active) {
    h +=
      `<tr>` +
      `<td>${esc(c.jid)}</td>` +
      `<td>${esc(c.name)}</td>` +
      `<td>${countByChat[c.jid] ?? 0}</td>` +
      `<td>${ago(c.last_message_time)}</td>` +
      `</tr>`;
  }
  return h + '</table>';
}

const BLOCKS = [
  ' ',
  '\u2581',
  '\u2582',
  '\u2583',
  '\u2584',
  '\u2585',
  '\u2586',
  '\u2587',
  '\u2588',
];

function renderFlow(): string {
  const msgs = getRecentMessages(1000);
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const byGroup: Record<string, number> = {};
  for (const m of msgs) {
    if (m.timestamp >= cutoff) {
      const g = m.group_folder ?? 'unknown';
      byGroup[g] = (byGroup[g] ?? 0) + 1;
    }
  }
  if (Object.keys(byGroup).length === 0) return '<p><em>No activity.</em></p>';
  const max = Math.max(...Object.values(byGroup));
  let h = '<pre>';
  for (const [g, n] of Object.entries(byGroup).sort((a, b) => b[1] - a[1])) {
    const barLen = Math.round((n / max) * 20);
    const bar = BLOCKS[8].repeat(barLen);
    h += `${g.padEnd(24).slice(0, 24)} ${bar} ${n}\n`;
  }
  return h + '</pre>';
}

function renderRoutes(): string {
  const routes = getAllRoutes();
  if (routes.length === 0) return '<p><em>No routes.</em></p>';
  let h =
    '<table><tr><th>JID</th><th>Seq</th><th>Type</th><th>Match</th><th>Target</th></tr>';
  for (const r of routes) {
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
      `<td>${esc(r.jid)}</td>` +
      `<td>${r.seq}</td>` +
      `<td style="color:${typeColor}">${esc(r.type)}</td>` +
      `<td>${r.match ? esc(r.match) : '—'}</td>` +
      `<td>${esc(r.target)}${isTemplate ? ' <em style="color:#9ca3af">\u27e8template\u27e9</em>' : ''}</td>` +
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
pre { background: #f8f8f8; padding: 10px; overflow-x: auto; }
`.trim();

const SHELL_HTML = `<!DOCTYPE html>
<html><head><title>Messages &amp; Activity</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${CSS}</style></head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Messages &amp; Activity</h1>
<h2>24h Summary</h2>
<div hx-get="/dash/activity/x/summary" hx-trigger="load, every 30s" hx-swap="innerHTML">Loading...</div>
<h2>Recent Messages</h2>
<div hx-get="/dash/activity/x/recent" hx-trigger="load, every 10s" hx-swap="innerHTML">Loading...</div>
<h2>Active Chats (24h)</h2>
<div hx-get="/dash/activity/x/chats" hx-trigger="load, every 30s" hx-swap="innerHTML">Loading...</div>
<h2>Message Flow by Group</h2>
<div hx-get="/dash/activity/x/flow" hx-trigger="load, every 60s" hx-swap="innerHTML">Loading...</div>
<h2>Routes</h2>
<div hx-get="/dash/activity/x/routes" hx-trigger="load, every 60s" hx-swap="innerHTML">Loading...</div>
</body></html>`;

function activityHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  _ctx: DashboardContext,
): void {
  const urlObj = new URL(p, 'http://localhost');
  const sub = urlObj.pathname;

  if (sub === '/x/summary') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderSummary());
    return;
  }
  if (sub === '/x/recent') {
    const chat = urlObj.searchParams.get('chat') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderRecent(chat));
    return;
  }
  if (sub === '/x/chats') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderChats());
    return;
  }
  if (sub === '/x/flow') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderFlow());
    return;
  }
  if (sub === '/x/routes') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderRoutes());
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHELL_HTML);
}

function activityHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  const msgs = getRecentMessages(1);
  if (msgs.length === 0)
    return { status: 'error', summary: 'no messages ever' };
  const latest = msgs[0].timestamp;
  const diffMs = Date.now() - new Date(latest).getTime();
  if (diffMs > 24 * 3600 * 1000)
    return { status: 'error', summary: 'no messages in 24h' };
  if (diffMs > 3600 * 1000)
    return { status: 'warn', summary: 'no messages in 1h' };
  return { status: 'ok', summary: `last message ${ago(latest)} ago` };
}

registerDashboard({
  name: 'activity',
  title: 'Messages & Activity',
  description: 'Recent messages, chats, and routing',
  handler: activityHandler,
  health: activityHealth,
});
