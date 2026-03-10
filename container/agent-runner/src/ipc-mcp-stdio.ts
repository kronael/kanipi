import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

const IPC_DIR = '/workspace/ipc';
const REQUESTS_DIR = path.join(IPC_DIR, 'requests');
const REPLIES_DIR = path.join(IPC_DIR, 'replies');
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isRoot = process.env.NANOCLAW_IS_ROOT === '1';
function rand() { return Math.random().toString(36).slice(2, 8); }
function writeRequest(data: object & { id: string; type: string }): void {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
  const tmp = path.join(REQUESTS_DIR, `${data.id}.json.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, path.join(REQUESTS_DIR, `${data.id}.json`));
}

function waitForReply(id: string, timeoutMs = 30000): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const file = path.join(REPLIES_DIR, `${id}.json`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      if (fs.existsSync(file)) {
        try {
          const r = JSON.parse(fs.readFileSync(file, 'utf-8'));
          try { fs.unlinkSync(file); } catch {}
          resolve(r);
          return;
        } catch {
          // parse failed — file partially written, retry on next poll
        }
      }
      if (Date.now() - t0 > timeoutMs) { resolve({ ok: false, error: 'timeout' }); return; }
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function callAction(type: string, input: Record<string, unknown>) {
  const id = `${Date.now()}-${rand()}`;
  writeRequest({ id, type, ...input });
  const reply = await waitForReply(id);
  if (!reply.ok) return { content: [{ type: 'text' as const, text: reply.error || 'action failed' }], isError: true };
  const text = typeof reply.result === 'string' ? reply.result : JSON.stringify(reply.result ?? { ok: true });
  return { content: [{ type: 'text' as const, text }] };
}

function toZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
  const s = schema as Record<string, unknown>;
  if (s?.type !== 'object' || !s?.properties) return {};
  const req = new Set<string>((s.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(s.properties as Record<string, Record<string, unknown>>)) {
    let t: z.ZodTypeAny =
      v.type === 'string' ? (v.enum ? z.enum(v.enum as [string, ...string[]]) : z.string())
      : v.type === 'number' || v.type === 'integer' ? z.number()
      : v.type === 'boolean' ? z.boolean()
      : v.type === 'array' ? z.array(z.unknown())
      : z.unknown();
    if (v.description) t = t.describe(v.description as string);
    if (!req.has(k)) t = t.optional();
    shape[k] = t;
  }
  return shape;
}

async function fetchManifest(): Promise<Array<{ name: string; description: string; input: unknown }>> {
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    const id = `manifest-${Date.now()}-${rand()}`;
    writeRequest({ id, type: 'list_actions' });
    const reply = await waitForReply(id, 2000);
    if (reply.ok && Array.isArray(reply.result)) return reply.result;
  }
  return [];
}

const server = new McpServer({ name: 'nanoclaw', version: '1.0.0' });

// list_tasks: reads current_tasks.json locally (no IPC round-trip)
server.tool('list_tasks', 'List all scheduled tasks.', {}, async () => {
  const file = path.join(IPC_DIR, 'current_tasks.json');
  if (!fs.existsSync(file)) return { content: [{ type: 'text', text: 'No scheduled tasks found.' }] };
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const tasks = isRoot ? all
      : all.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);
    if (!tasks.length) return { content: [{ type: 'text', text: 'No scheduled tasks found.' }] };
    interface Task {
      id: string; prompt: string; schedule_type: string;
      schedule_value: string; status: string; next_run: string;
    }
    const text = tasks.map((t: Task) =>
      `- [${t.id}] ${t.prompt.slice(0, 50)}... ` +
      `(${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`
    ).join('\n');
    return { content: [{ type: 'text', text: `Scheduled tasks:\n${text}` }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error reading tasks: ${msg}` }] };
  }
});

for (const action of await fetchManifest()) {
  server.tool(action.name, action.description, toZodShape(action.input),
    async (args) => callAction(action.name, { ...(args as Record<string, unknown>), chatJid }));
}

await server.connect(new StdioServerTransport());
