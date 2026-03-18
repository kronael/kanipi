import http from 'http';

import { getPendingOnboarding, getAllOnboarding } from '../db.js';
import { registerDashboard, DashboardContext } from './index.js';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function renderSummary(): string {
  const all = getAllOnboarding();
  const pending = all.filter((e) => e.status === 'pending').length;
  const approved = all.filter((e) => e.status === 'approved').length;
  const rejected = all.filter((e) => e.status === 'rejected').length;
  const pendingStyle = pending > 0 ? ' style="color:#f59e0b"' : '';
  return (
    `<table><tr>` +
    `<th>Total</th><th>Pending</th><th>Approved</th><th>Rejected</th>` +
    `</tr><tr>` +
    `<td>${all.length}</td>` +
    `<td${pendingStyle}>${pending}</td>` +
    `<td style="color:#22c55e">${approved}</td>` +
    `<td style="color:#9ca3af">${rejected}</td>` +
    `</tr></table>`
  );
}

function renderPending(): string {
  const entries = getPendingOnboarding();
  if (entries.length === 0) return '<p><em>No pending requests.</em></p>';
  let h =
    '<table><tr><th>JID</th><th>Sender</th><th>World name</th>' +
    '<th>Requested</th><th>Approve command</th></tr>';
  for (const e of entries) {
    const cmd = `/approve ${e.jid}`;
    h +=
      `<tr>` +
      `<td>${esc(e.jid)}</td>` +
      `<td>${esc(e.sender ?? '—')}</td>` +
      `<td>${esc(e.world_name ?? '—')}</td>` +
      `<td>${esc(timeAgo(e.created))}</td>` +
      `<td><code style="user-select:all">${esc(cmd)}</code></td>` +
      `</tr>`;
  }
  return h + '</table>';
}

function renderHistory(): string {
  const all = getAllOnboarding();
  const history = all
    .filter((e) => e.status === 'approved' || e.status === 'rejected')
    .slice(0, 20);
  if (history.length === 0) return '<p><em>No history yet.</em></p>';
  let h =
    '<table><tr><th>JID</th><th>World name</th><th>Outcome</th><th>When</th></tr>';
  for (const e of history) {
    const outcomeStyle =
      e.status === 'approved' ? 'color:#22c55e' : 'color:#9ca3af';
    h +=
      `<tr>` +
      `<td>${esc(e.jid)}</td>` +
      `<td>${esc(e.world_name ?? '—')}</td>` +
      `<td style="${outcomeStyle}">${esc(e.status)}</td>` +
      `<td>${esc(e.created.slice(0, 16).replace('T', ' '))}</td>` +
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
code { background: #f0f0f0; padding: 2px 4px; }
`.trim();

const SHELL_HTML = `<!DOCTYPE html>
<html><head><title>Onboarding</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${CSS}</style></head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Onboarding</h1>
<div hx-get="/dash/onboarding/x/summary" hx-trigger="load, every 30s" hx-swap="innerHTML">Loading...</div>
<h2>Pending requests</h2>
<div hx-get="/dash/onboarding/x/pending" hx-trigger="load, every 15s" hx-swap="innerHTML">Loading...</div>
<h2>Recent history</h2>
<div hx-get="/dash/onboarding/x/history" hx-trigger="load, every 60s" hx-swap="innerHTML">Loading...</div>
</body></html>`;

function onboardingHandler(
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

  if (sub === '/x/pending') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPending());
    return;
  }

  if (sub === '/x/history') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderHistory());
    return;
  }

  if (sub === '/api/pending') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getPendingOnboarding()));
    return;
  }

  if (sub === '/api/all') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAllOnboarding()));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SHELL_HTML);
}

function onboardingHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  const pending = getPendingOnboarding();
  const cutoff = new Date(Date.now() - 3600 * 1000).toISOString();
  const stale = pending.filter((e) => e.created < cutoff);
  if (stale.length > 0) {
    return { status: 'warn', summary: `${pending.length} pending` };
  }
  return { status: 'ok', summary: `${pending.length} pending` };
}

registerDashboard({
  name: 'onboarding',
  title: 'Onboarding',
  description: 'Workspace request queue and approval history',
  handler: onboardingHandler,
  health: onboardingHealth,
});
