import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const REQUESTS_DIR = path.join(IPC_DIR, 'requests');
const REPLIES_DIR = path.join(IPC_DIR, 'replies');
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isRoot = process.env.NANOCLAW_IS_ROOT === '1';

const REPLY_POLL_MS = 100;
const REPLY_TIMEOUT_MS = 30000;

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${rand()}.json`;
  const filepath = path.join(dir, filename);
  const tmp = `${filepath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filepath);
  return filename;
}

function writeRequest(data: object & { id: string; type: string }): void {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
  const tmp = path.join(REQUESTS_DIR, `${data.id}.json.tmp`);
  const final = path.join(REQUESTS_DIR, `${data.id}.json`);
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, final);
}

function waitForReply(
  id: string,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const replyPath = path.join(REPLIES_DIR, `${id}.json`);
  const start = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      if (fs.existsSync(replyPath)) {
        try {
          const reply = JSON.parse(
            fs.readFileSync(replyPath, 'utf-8'),
          );
          try { fs.unlinkSync(replyPath); } catch {}
          resolve(reply);
          return;
        } catch {
          // partial write, retry
        }
      }
      if (Date.now() - start > REPLY_TIMEOUT_MS) {
        resolve({ ok: false, error: 'timeout waiting for reply' });
        return;
      }
      setTimeout(poll, REPLY_POLL_MS);
    };
    poll();
  });
}

async function callAction(
  type: string,
  input: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const id = `${Date.now()}-${rand()}`;
  writeRequest({ id, type, ...input });
  const reply = await waitForReply(id);
  if (!reply.ok) {
    return {
      content: [{ type: 'text', text: reply.error || 'action failed' }],
      isError: true,
    };
  }
  const text = typeof reply.result === 'string'
    ? reply.result
    : JSON.stringify(reply.result ?? { ok: true });
  return { content: [{ type: 'text', text }] };
}

const useRequestReply =
  fs.existsSync(REQUESTS_DIR) && fs.existsSync(REPLIES_DIR);

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send an intermediate status update to the user while still running. WARNING: your final response is sent automatically — do not repeat it here or the user receives it twice. Exception: scheduled tasks do not auto-send output, so use this to deliver results.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    if (useRequestReply) {
      return callAction('send_message', {
        chatJid,
        text: args.text,
        sender: args.sender,
      });
    }
    writeIpcFile(MESSAGES_DIR, {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text', text: 'Message sent.' }] };
  },
);

server.tool(
  'send_file',
  'Send a file from the workspace to the user in chat. ' +
  'Store files you want to keep under /workspace/group/{folder}/media/YYYYMMDD/. ' +
  'All file types are supported.',
  {
    filepath: z.string().describe('Absolute path to file, e.g. /workspace/group/main/media/20260304/report.csv'),
    filename: z.string().optional().describe('Display name for the file'),
  },
  async (args) => {
    if (useRequestReply) {
      return callAction('send_file', {
        chatJid,
        filepath: args.filepath,
        filename: args.filename,
      });
    }
    writeIpcFile(MESSAGES_DIR, {
      type: 'file',
      chatJid,
      filepath: args.filepath,
      filename: args.filename,
      groupFolder,
      timestamp: new Date().toISOString(),
    });
    return { content: [{ type: 'text', text: 'File queued for sending.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CONTEXT MODE:
\u2022 "group": Task runs with chat history context
\u2022 "isolated": Fresh session, include all context in prompt

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: "0 9 * * *" (daily 9am), "*/5 * * * *" (every 5 min)
\u2022 interval: milliseconds like "300000" (5 min)
\u2022 once: local time "2026-02-01T15:30:00" (no Z suffix)`,
  {
    prompt: z.string().describe('What the agent should do when the task runs'),
    schedule_type: z.enum(['cron', 'interval', 'once']),
    schedule_value: z.string(),
    context_mode: z.enum(['group', 'isolated']).default('group'),
    target_group_jid: z.string().optional().describe('(Root only) JID of target group'),
  },
  async (args) => {
    if (args.schedule_type === 'cron') {
      try { CronExpressionParser.parse(args.schedule_value); } catch {
        return {
          content: [{ type: 'text', text: `Invalid cron: "${args.schedule_value}"` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text', text: `Invalid interval: "${args.schedule_value}"` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (/[Zz]$/.test(args.schedule_value) || /[+-]\d{2}:\d{2}$/.test(args.schedule_value)) {
        return {
          content: [{ type: 'text', text: `Use local time without timezone suffix` }],
          isError: true,
        };
      }
      if (isNaN(new Date(args.schedule_value).getTime())) {
        return {
          content: [{ type: 'text', text: `Invalid timestamp: "${args.schedule_value}"` }],
          isError: true,
        };
      }
    }

    const targetJid = isRoot && args.target_group_jid
      ? args.target_group_jid
      : chatJid;

    if (useRequestReply) {
      return callAction('schedule_task', {
        targetJid,
        prompt: args.prompt,
        schedule_type: args.schedule_type,
        schedule_value: args.schedule_value,
        context_mode: args.context_mode,
      });
    }

    const filename = writeIpcFile(TASKS_DIR, {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode,
      targetJid,
      timestamp: new Date().toISOString(),
    });
    return {
      content: [{ type: 'text', text: `Task scheduled (${filename})` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');
    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text', text: 'No scheduled tasks found.' }] };
      }
      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
      const tasks = isRoot
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);
      if (tasks.length === 0) {
        return { content: [{ type: 'text', text: 'No scheduled tasks found.' }] };
      }
      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');
      return { content: [{ type: 'text', text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

for (const [name, desc] of [
  ['pause_task', 'Pause a scheduled task'],
  ['resume_task', 'Resume a paused task'],
  ['cancel_task', 'Cancel and delete a scheduled task'],
] as const) {
  server.tool(
    name,
    desc,
    { task_id: z.string().describe('The task ID') },
    async (args) => {
      if (useRequestReply) {
        return callAction(name, { taskId: args.task_id });
      }
      writeIpcFile(TASKS_DIR, {
        type: name,
        taskId: args.task_id,
        groupFolder,
        isRoot,
        timestamp: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text', text: `Task ${args.task_id} ${name.replace('_task', '')} requested.` }],
      };
    },
  );
}

server.tool(
  'register_group',
  'Register a new group. Root group only.',
  {
    jid: z.string().describe('Group JID'),
    name: z.string().describe('Display name'),
    folder: z.string().describe('Folder name (lowercase, hyphens)'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isRoot) {
      return {
        content: [{ type: 'text', text: 'Only the root group can register new groups.' }],
        isError: true,
      };
    }
    if (useRequestReply) {
      return callAction('register_group', {
        jid: args.jid,
        name: args.name,
        folder: args.folder,
        trigger: args.trigger,
      });
    }
    writeIpcFile(TASKS_DIR, {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    });
    return {
      content: [{ type: 'text', text: `Group "${args.name}" registered.` }],
    };
  },
);

server.tool(
  'delegate_group',
  'Delegate a task to a child group.',
  {
    group: z.string().describe('Target group folder'),
    prompt: z.string().describe('What the child should do'),
  },
  async (args) => {
    return callAction('delegate_group', {
      group: args.group,
      prompt: args.prompt,
      chatJid,
    });
  },
);

server.tool(
  'escalate_group',
  'Escalate to parent group.',
  {
    prompt: z.string().describe('Context for parent'),
  },
  async (args) => {
    return callAction('escalate_group', {
      prompt: args.prompt,
      chatJid,
    });
  },
);

server.tool(
  'set_routing_rules',
  'Set message routing rules for this group\'s children.',
  {
    rules: z.string().describe('JSON array of routing rules'),
  },
  async (args) => {
    return callAction('set_routing_rules', {
      folder: groupFolder,
      rules: args.rules,
    });
  },
);

server.tool(
  'refresh_groups',
  'Refresh group metadata from channels. Root only.',
  {},
  async () => {
    if (!isRoot) {
      return {
        content: [{ type: 'text', text: 'Only root can refresh groups.' }],
        isError: true,
      };
    }
    return callAction('refresh_groups', {});
  },
);

server.tool(
  'inject_message',
  'Inject a synthetic message into a group. Root only.',
  {
    targetFolder: z.string().describe('Target group folder'),
    text: z.string().describe('Message text'),
    sender: z.string().optional().describe('Sender name'),
  },
  async (args) => {
    if (!isRoot) {
      return {
        content: [{ type: 'text', text: 'Only root can inject messages.' }],
        isError: true,
      };
    }
    return callAction('inject_message', {
      targetFolder: args.targetFolder,
      text: args.text,
      sender: args.sender,
      chatJid,
    });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
