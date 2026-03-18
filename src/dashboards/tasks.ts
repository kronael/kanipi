import http from 'http';

import { getAllTasks, getTaskRunLogsForTask } from '../db.js';
import { registerDashboard, DashboardContext } from './index.js';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cronHuman(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [min, hour, dom, , dow] = p;
  if (min === '*' && hour === '*' && dom === '*' && dow === '*')
    return 'every minute';
  if (dom === '*' && dow === '*') {
    if (min === '0' && hour === '*') return 'hourly';
    if (min === '0') return `daily ${hour.padStart(2, '0')}:00`;
    if (hour === '*') return `every hour at :${min.padStart(2, '0')}`;
    return `daily ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = parseInt(dow, 10);
    const dayName = isNaN(d) ? dow : (days[d] ?? dow);
    return `weekly ${dayName} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  return expr;
}

function statusColor(s: string): string {
  if (s === 'active') return 'color:#22c55e';
  if (s === 'paused') return 'color:#9ca3af';
  if (s === 'completed') return 'color:#6b7280';
  return 'color:#ef4444';
}

function renderSummary(): string {
  const tasks = getAllTasks();
  const now = Date.now();
  const cutoff = new Date(now - 24 * 3600 * 1000).toISOString();
  const active = tasks.filter((t) => t.status === 'active').length;
  const paused = tasks.filter((t) => t.status === 'paused').length;
  const failed = tasks.filter(
    (t) => t.last_run && t.last_run >= cutoff && t.last_result === 'error',
  ).length;
  return (
    `<table><tr>` +
    `<th>Total</th><th>Active</th><th>Paused</th><th>Failed (24h)</th>` +
    `</tr><tr>` +
    `<td>${tasks.length}</td>` +
    `<td style="color:#22c55e">${active}</td>` +
    `<td style="color:#9ca3af">${paused}</td>` +
    `<td style="${failed > 0 ? 'color:#ef4444' : ''}">${failed}</td>` +
    `</tr></table>`
  );
}

function renderList(groupFilter: string, statusFilter: string): string {
  let tasks = getAllTasks();
  if (groupFilter) tasks = tasks.filter((t) => t.group_folder === groupFilter);
  if (statusFilter) tasks = tasks.filter((t) => t.status === statusFilter);

  if (tasks.length === 0) return '<p><em>No tasks.</em></p>';

  let h =
    '<table><tr><th>ID</th><th>Group</th><th>Schedule</th>' +
    '<th>Status</th><th>Next run</th><th>Last result</th><th></th></tr>';
  for (const t of tasks) {
    const schedLabel =
      t.schedule_type === 'cron'
        ? cronHuman(t.schedule_value)
        : `${t.schedule_type}: ${t.schedule_value}`;
    const next = t.next_run ? t.next_run.slice(0, 16).replace('T', ' ') : '—';
    const lastRes = t.last_result ? esc(t.last_result.slice(0, 40)) : '—';
    h +=
      `<tr>` +
      `<td>${esc(t.id)}</td>` +
      `<td>${esc(t.group_folder)}</td>` +
      `<td>${esc(schedLabel)}</td>` +
      `<td style="${statusColor(t.status)}">${t.status}</td>` +
      `<td>${esc(next)}</td>` +
      `<td>${lastRes}</td>` +
      `<td><a href="/dash/tasks/x/detail?id=${esc(t.id)}" hx-get="/dash/tasks/x/detail?id=${esc(t.id)}" hx-target="#detail" hx-swap="innerHTML">detail</a></td>` +
      `</tr>`;
  }
  return h + '</table>';
}

function renderDetail(id: string): string {
  const tasks = getAllTasks();
  const t = tasks.find((x) => x.id === id);
  if (!t) return '<p><em>Task not found.</em></p>';

  const logs = getTaskRunLogsForTask(t.id, 20);
  let h =
    `<h3>Task: ${esc(t.id)}</h3>` +
    `<table>` +
    `<tr><th>Group</th><td>${esc(t.group_folder)}</td></tr>` +
    `<tr><th>Chat JID</th><td>${esc(t.chat_jid)}</td></tr>` +
    `<tr><th>Schedule</th><td>${esc(t.schedule_type)}: ${esc(t.schedule_value)}</td></tr>` +
    `<tr><th>Status</th><td style="${statusColor(t.status)}">${t.status}</td></tr>` +
    `<tr><th>Context mode</th><td>${t.context_mode}</td></tr>` +
    `<tr><th>Next run</th><td>${t.next_run ?? '—'}</td></tr>` +
    `<tr><th>Last run</th><td>${t.last_run ?? '—'}</td></tr>`;
  if (t.prompt)
    h += `<tr><th>Prompt</th><td><pre>${esc(t.prompt.slice(0, 200))}</pre></td></tr>`;
  if (t.command)
    h += `<tr><th>Command</th><td><code>${esc(t.command)}</code></td></tr>`;
  h += '</table>';

  if (logs.length > 0) {
    h += '<h4>Run history (last 20)</h4>';
    h +=
      '<table><tr><th>Run at</th><th>Duration</th><th>Status</th><th>Result / Error</th></tr>';
    for (const l of logs) {
      const txt = (l.result || l.error || '').slice(0, 100);
      const sc = l.status === 'success' ? 'color:#22c55e' : 'color:#ef4444';
      h +=
        `<tr>` +
        `<td>${esc(l.run_at.slice(0, 19).replace('T', ' '))}</td>` +
        `<td>${l.duration_ms}ms</td>` +
        `<td style="${sc}">${l.status}</td>` +
        `<td>${esc(txt)}</td>` +
        `</tr>`;
    }
    h += '</table>';
  }
  return h;
}

function buildGroupOptions(selected: string): string {
  const tasks = getAllTasks();
  const groups = [...new Set(tasks.map((t) => t.group_folder))].sort();
  let opts = `<option value="">All groups</option>`;
  for (const g of groups) {
    opts += `<option value="${esc(g)}"${selected === g ? ' selected' : ''}>${esc(g)}</option>`;
  }
  return opts;
}

const CSS = `
body { font-family: monospace; max-width: 900px; margin: 20px auto; padding: 0 20px; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; }
th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
th { background: #f0f0f0; }
a { color: #0066cc; }
select { font-family: monospace; margin-right: 8px; }
pre { margin: 0; white-space: pre-wrap; }
h2 { margin-top: 24px; }
`.trim();

const SHELL_HTML = `<!DOCTYPE html>
<html><head><title>Tasks</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>${CSS}</style></head>
<body>
<p><a href="/dash/">&larr; Dashboards</a></p>
<h1>Tasks</h1>
<div id="summary" hx-get="/dash/tasks/x/summary" hx-trigger="load, every 10s" hx-swap="innerHTML">Loading...</div>
<h2>Filter</h2>
<form hx-get="/dash/tasks/x/list" hx-target="#tasklist" hx-swap="innerHTML" hx-trigger="change, submit">
  <select name="group" id="group-sel">GROUPOPTS</select>
  <select name="status">
    <option value="">All statuses</option>
    <option value="active">active</option>
    <option value="paused">paused</option>
    <option value="completed">completed</option>
  </select>
</form>
<div id="tasklist" hx-get="/dash/tasks/x/list" hx-trigger="load, every 10s" hx-swap="innerHTML">Loading...</div>
<div id="detail"></div>
</body></html>`;

function tasksHandler(
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

  if (sub === '/x/list') {
    const group = urlObj.searchParams.get('group') ?? '';
    const status = urlObj.searchParams.get('status') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderList(group, status));
    return;
  }

  if (sub === '/x/detail') {
    const id = urlObj.searchParams.get('id') ?? '';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderDetail(id));
    return;
  }

  // Shell
  const shell = SHELL_HTML.replace('GROUPOPTS', buildGroupOptions(''));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(shell);
}

function tasksHealth(_ctx: DashboardContext): {
  status: 'ok' | 'warn' | 'error';
  summary: string;
} {
  const tasks = getAllTasks();
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let failures24h = 0;
  let consecutiveFail = false;

  for (const t of tasks) {
    const logs = getTaskRunLogsForTask(t.id, 5);
    const recent = logs.filter(
      (l) => l.run_at >= cutoff && l.status === 'error',
    );
    failures24h += recent.length;
    if (
      logs.length >= 3 &&
      logs.slice(0, 3).every((l) => l.status === 'error')
    ) {
      consecutiveFail = true;
    }
  }

  if (consecutiveFail || failures24h >= 3) {
    return { status: 'error', summary: `${failures24h} failures in 24h` };
  }
  if (failures24h > 0) {
    return { status: 'warn', summary: `${failures24h} failures in 24h` };
  }
  return { status: 'ok', summary: `${tasks.length} tasks` };
}

registerDashboard({
  name: 'tasks',
  title: 'Tasks',
  description: 'Scheduled task status and run history',
  handler: tasksHandler,
  health: tasksHealth,
});
