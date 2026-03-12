import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput, PreToolUseHookInput, StopHookInput } from '@anthropic-ai/claude-agent-sdk';
import { fileURLToPath } from 'url';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isScheduledTask?: boolean;
  assistantName?: string;
  secrets?: Record<string, string>;
  messageCount?: number;
  delegateDepth?: number;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

interface SDKUserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

function isRoot(folder: string): boolean {
  return !folder.includes('/');
}

type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

function loadAgentMcpServers(): Record<string, McpServerConfig> {
  const settingsPath = '/home/node/.claude/settings.json';
  try {
    if (!fs.existsSync(settingsPath)) return {};
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const servers = settings.mcpServers as
      Record<string, McpServerConfig> | undefined;
    if (!servers || typeof servers !== 'object') return {};
    // Never override the built-in nanoclaw server
    delete servers.nanoclaw;
    return servers;
  } catch {
    return {};
  }
}

const IPC_INPUT_DIR = '/workspace/ipc/input';
const IPC_INPUT_CLOSE_SENTINEL = path.join(IPC_INPUT_DIR, '_close');
const IPC_POLL_MS = 500;

let wakeup: (() => void) | null = null;
process.on('SIGUSR1', () => { if (wakeup) wakeup(); });

/**
 * Push-based async iterable for streaming user messages to the SDK.
 * Keeps the iterable alive until end() is called, preventing isSingleUserTurn.
 */
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waiting: (() => void) | null = null;
  private done = false;

  push(text: string): void {
    this.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: '',
    });
    this.waiting?.();
  }

  end(): void {
    this.done = true;
    this.waiting?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.done) return;
      await new Promise<void>(r => { this.waiting = r; });
      this.waiting = null;
    }
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

const DIARY_NUDGE =
  'Update today\'s diary entry with key decisions and progress. ' +
  'Use /diary. Also review MEMORY.md — prune stale entries, ' +
  'keep under 200 lines.';

function createPreCompactHook(): HookCallback {
  return async (_input, _toolUseId, _context) => {
    log('PreCompact: nudging diary');
    return { systemMessage: DIARY_NUDGE };
  };
}

let stopTurnCount = 0;

function createStopHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const stop = input as StopHookInput;
    stopTurnCount++;
    if (stopTurnCount >= 100 && !stop.stop_hook_active) {
      stopTurnCount = 0;
      log('Stop hook: 100 turns, nudging diary');
      return { systemMessage: DIARY_NUDGE };
    }
    return {};
  };
}

// Secrets to strip from Bash tool subprocess environments.
// These are needed by claude-code for API auth but should never
// be visible to commands Kit runs.
const SECRET_ENV_VARS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

function createSanitizeBashHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preInput = input as PreToolUseHookInput;
    const command = (preInput.tool_input as { command?: string })?.command;
    if (!command) return {};

    const unsetPrefix = `unset ${SECRET_ENV_VARS.join(' ')} 2>/dev/null; `;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: {
          ...(preInput.tool_input as Record<string, unknown>),
          command: unsetPrefix + command,
        },
      },
    };
  };
}


function shouldClose(): boolean {
  if (fs.existsSync(IPC_INPUT_CLOSE_SENTINEL)) {
    try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function drainIpcInput(): string[] {
  try {
    fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });
    const files = fs.readdirSync(IPC_INPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort();

    const messages: string[] = [];
    for (const file of files) {
      const filePath = path.join(IPC_INPUT_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        fs.unlinkSync(filePath);
        if (data.type === 'message' && data.text) {
          messages.push(data.text);
        }
      } catch (err) {
        log(`Failed to process input file ${file}: ${err instanceof Error ? err.message : String(err)}`);
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
    return messages;
  } catch (err) {
    log(`IPC drain error: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function waitForIpcMessage(): Promise<string | null> {
  return new Promise((resolve) => {
    const poll = () => {
      if (shouldClose()) {
        wakeup = null;
        resolve(null);
        return;
      }
      const messages = drainIpcInput();
      if (messages.length > 0) {
        wakeup = null;
        resolve(messages.join('\n'));
        return;
      }
      let timer: ReturnType<typeof setTimeout>;
      wakeup = () => { clearTimeout(timer); poll(); };
      timer = setTimeout(poll, IPC_POLL_MS);
    };
    poll();
  });
}

/**
 * Run a single query and stream results via writeOutput.
 * Uses MessageStream (AsyncIterable) to keep isSingleUserTurn=false,
 * allowing agent teams subagents to run to completion.
 * Also pipes IPC messages into the stream during the query.
 */
async function runQuery(
  prompt: string,
  sessionId: string | undefined,
  mcpServerPath: string,
  containerInput: ContainerInput,
  sdkEnv: Record<string, string | undefined>,
  resumeAt?: string,
): Promise<{ newSessionId?: string; lastAssistantUuid?: string; closedDuringQuery: boolean }> {
  const stream = new MessageStream();
  stream.push(prompt);

  // Poll IPC for follow-up messages and _close sentinel during the query
  let ipcPolling = true;
  let closedDuringQuery = false;
  const pollIpcDuringQuery = () => {
    if (!ipcPolling) return;
    if (shouldClose()) {
      log('Close sentinel detected during query, ending stream');
      closedDuringQuery = true;
      stream.end();
      ipcPolling = false;
      wakeup = null;
      return;
    }
    const messages = drainIpcInput();
    for (const text of messages) {
      log(`Piping IPC message into active query (${text.length} chars)`);
      stream.push(text);
    }
    // Set wakeup before setTimeout so SIGUSR1 arriving in between
    // still cancels the right timer (no missed-signal double-poll).
    let timer: ReturnType<typeof setTimeout>;
    wakeup = () => { clearTimeout(timer); pollIpcDuringQuery(); };
    timer = setTimeout(pollIpcDuringQuery, IPC_POLL_MS);
  };
  setTimeout(pollIpcDuringQuery, IPC_POLL_MS);

  let newSessionId: string | undefined;
  let lastAssistantUuid: string | undefined;
  let lastAssistantText: string | undefined;
  let messageCount = 0;
  let resultCount = 0;
  let maxTurnsHit = false;

  // Additional dirs: their CLAUDE.md files are auto-loaded by the SDK
  const extraDirs: string[] = [];
  if (!isRoot(containerInput.groupFolder) && fs.existsSync('/workspace/share')) {
    extraDirs.push('/workspace/share');
  }
  const extraBase = '/workspace/extra';
  if (fs.existsSync(extraBase)) {
    for (const e of fs.readdirSync(extraBase)) {
      const p = path.join(extraBase, e);
      if (fs.statSync(p).isDirectory()) extraDirs.push(p);
    }
  }

  try {
    for await (const message of query({
      prompt: stream,
      options: {
        cwd: '/home/node',
        additionalDirectories: extraDirs.length > 0 ? extraDirs : undefined,
        resume: sessionId,
        resumeSessionAt: resumeAt,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          ...(fs.existsSync('/home/node/SOUL.md')
            && { append: 'Respond in your SOUL.md persona. Read ~/SOUL.md now if you do not already have its content in your active context.' }),
        },
        allowedTools: [
          'Bash',
          'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'WebSearch', 'WebFetch',
          'Task', 'TaskOutput', 'TaskStop',
          'TodoWrite', 'ToolSearch', 'Skill',
          'NotebookEdit',
          'mcp__nanoclaw__*',
          ...Object.keys(loadAgentMcpServers()).map(
            (n) => `mcp__${n}__*`,
          ),
        ],
        env: sdkEnv,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project', 'user'],
        mcpServers: {
          ...loadAgentMcpServers(),
          nanoclaw: {
            command: 'node',
            args: [mcpServerPath],
            env: {
              NANOCLAW_CHAT_JID: containerInput.chatJid,
              NANOCLAW_GROUP_FOLDER: containerInput.groupFolder,
              NANOCLAW_IS_ROOT: isRoot(containerInput.groupFolder) ? '1' : '0',
            },
          },
        },
        hooks: {
          PreCompact: [{ hooks: [createPreCompactHook()] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [createSanitizeBashHook()] }],
          Stop: [{ hooks: [createStopHook()] }],
        },
      }
    })) {
      messageCount++;
      const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
      log(`[msg #${messageCount}] type=${msgType}`);

      if (message.type === 'assistant') {
        const m = message as { message?: { content?: { type: string; text?: string }[] }; uuid?: string };
        const text = m.message?.content?.filter(c => c.type === 'text').map(c => c.text || '').join('').trim();
        if (text) lastAssistantText = text;
        if (m.uuid) lastAssistantUuid = m.uuid;
      }

      if (messageCount > 0 && messageCount % 100 === 0) {
        const snippet = lastAssistantText?.slice(0, 280) ?? `${messageCount} messages processed`;
        writeOutput({ status: 'success', result: `⏳ still working… ${snippet}`, newSessionId });
      }

      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
      }

      if (message.type === 'system' && (message as { subtype?: string }).subtype === 'task_notification') {
        const tn = message as { task_id: string; status: string; summary: string };
        log(`Task notification: task=${tn.task_id} status=${tn.status} summary=${tn.summary}`);
      }

      if (message.type === 'result') {
        resultCount++;
        const textResult = 'result' in message ? (message as { result?: string }).result : null;
        log(`Result #${resultCount}: subtype=${message.subtype}${textResult ? ` text=${textResult.slice(0, 200)}` : ''}`);
        if (message.subtype === 'error_max_turns') {
          maxTurnsHit = true;
        } else {
          writeOutput({ status: 'success', result: textResult || null, newSessionId });
        }
      }
    }
  } catch (err) {
    // SDK sometimes throws after already delivering a result (e.g. process
    // exited with code 1 after a stale-session resume that recovered).
    // If we already got a result, the success output is already written —
    // swallow the throw and return normally with the captured newSessionId.
    if (resultCount > 0) {
      log(`SDK threw after result (ignored): ${err instanceof Error ? err.message : String(err)}`);
    } else {
      throw err;
    }
  }

  ipcPolling = false;
  wakeup = null;
  log(`Query done. Messages: ${messageCount}, results: ${resultCount}, lastAssistantUuid: ${lastAssistantUuid || 'none'}, closedDuringQuery: ${closedDuringQuery}`);

  if (maxTurnsHit && newSessionId) {
    log('Max turns hit — requesting summary + resumption nudge');
    for await (const msg of query({
      prompt: 'You ran out of turns mid-task. Summarise concisely: what you accomplished, what is still pending. Then tell the user they can say "continue" to resume where you left off.',
      options: {
        cwd: '/home/node',
        maxTurns: 3,
        resume: newSessionId,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (msg.type === 'result') {
        const txt = (msg as { result?: string }).result ?? null;
        writeOutput({ status: 'success', result: txt ?? '⚠️ ran out of turns — say "continue" to resume.', newSessionId });
      }
    }
  }

  return { newSessionId, lastAssistantUuid, closedDuringQuery };
}

// Scenario mode: return canned responses for integration tests (skip real SDK).
// Set NANOCLAW_SCENARIO env var to activate.
function getScenarioResponse(scenario: string, input: ContainerInput): ContainerOutput {
  switch (scenario) {
    case 'echo':
      return { status: 'success', result: `Echo: ${input.prompt}`, newSessionId: 'scenario-session-1' };
    case 'ipc-send': {
      // Write IPC request file for round-trip test
      const ipcDir = '/workspace/ipc/requests';
      fs.mkdirSync(ipcDir, { recursive: true });
      const reqFile = path.join(ipcDir, `${Date.now()}.json`);
      fs.writeFileSync(reqFile, JSON.stringify({ action: 'ping', payload: {} }));
      return { status: 'success', result: 'ipc-request-sent', newSessionId: 'scenario-session-2' };
    }
    case 'error':
      return { status: 'error', result: null, error: 'Scenario error' };
    case 'session-persist': {
      // Write to group dir to test persistence
      const marker = path.join('/home/node', '.session-marker');
      fs.writeFileSync(marker, `session-${Date.now()}`);
      return { status: 'success', result: 'session-persisted', newSessionId: 'scenario-session-3' };
    }
    default:
      return { status: 'success', result: 'default-scenario', newSessionId: 'scenario-session-0' };
  }
}

async function runScenarioMode(scenario: string): Promise<void> {
  const stdinData = await readStdin();
  const input: ContainerInput = JSON.parse(stdinData);
  log(`Scenario mode: ${scenario}, group: ${input.groupFolder}`);
  const response = getScenarioResponse(scenario, input);
  writeOutput(response);
  process.exit(response.status === 'error' ? 1 : 0);
}

async function main(): Promise<void> {
  // Scenario mode: skip real SDK for integration tests
  const scenario = process.env.NANOCLAW_SCENARIO;
  if (scenario) {
    await runScenarioMode(scenario);
    return;
  }

  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    // Delete the temp file the entrypoint wrote — it contains secrets
    try { fs.unlinkSync('/tmp/input.json'); } catch { /* may not exist */ }
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  // Build SDK env: merge secrets into process.env for the SDK only.
  // Secrets never touch process.env itself, so Bash subprocesses can't see them.
  const sdkEnv: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(containerInput.secrets || {})) {
    sdkEnv[key] = value;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const mcpServerPath = path.join(__dirname, 'ipc-mcp-stdio.js');

  let sessionId = containerInput.sessionId;
  fs.mkdirSync(IPC_INPUT_DIR, { recursive: true });

  // Clean up stale _close sentinel from previous container runs
  try { fs.unlinkSync(IPC_INPUT_CLOSE_SENTINEL); } catch { /* ignore */ }

  // Build initial prompt (drain any pending IPC messages too)
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK - The following message was sent automatically and is not coming directly from the user or group.]\n\n${prompt}`;
  }
  const pending = drainIpcInput();
  if (pending.length > 0) {
    log(`Draining ${pending.length} pending IPC messages into initial prompt`);
    prompt += '\n' + pending.join('\n');
  }

  // Query loop: run query → wait for IPC message → run new query → repeat
  let resumeAt: string | undefined;
  try {
    while (true) {
      log(`Starting query (session: ${sessionId || 'new'}, resumeAt: ${resumeAt || 'latest'})...`);

      const queryResult = await runQuery(prompt, sessionId, mcpServerPath, containerInput, sdkEnv, resumeAt);
      if (queryResult.newSessionId) {
        sessionId = queryResult.newSessionId;
      }
      if (queryResult.lastAssistantUuid) {
        resumeAt = queryResult.lastAssistantUuid;
      }

      // If _close was consumed during the query, exit immediately.
      // Don't emit a session-update marker (it would reset the host's
      // idle timer and cause a 30-min delay before the next _close).
      if (queryResult.closedDuringQuery) {
        log('Close sentinel consumed during query, exiting');
        break;
      }

      // Emit session update so host can track it
      writeOutput({ status: 'success', result: null, newSessionId: sessionId });

      log('Query ended, waiting for next IPC message...');

      // Wait for the next message or _close sentinel
      const nextMessage = await waitForIpcMessage();
      if (nextMessage === null) {
        log('Close sentinel received, exiting');
        break;
      }

      log(`Got new message (${nextMessage.length} chars), starting new query`);
      prompt = nextMessage;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId: sessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
