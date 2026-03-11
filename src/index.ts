import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  CONTAINER_IMAGE,
  DISCORD_BOT_TOKEN,
  EMAIL_IMAP_HOST,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  POLL_INTERVAL,
  SLOTH_USERS,
  TELEGRAM_BOT_TOKEN,
  TRIGGER_PATTERN,
  VITE_PORT_INTERNAL,
  WEB_DIR,
  WEB_PORT,
  WEB_PUBLIC,
  MASTODON_INSTANCE_URL,
  MASTODON_ACCESS_TOKEN,
  BLUESKY_IDENTIFIER,
  BLUESKY_PASSWORD,
  BLUESKY_SERVICE_URL,
  REDDIT_CLIENT_ID,
  REDDIT_CLIENT_SECRET,
  REDDIT_USERNAME,
  REDDIT_PASSWORD,
  TWITTER_USERNAME,
  TWITTER_PASSWORD,
  TWITTER_EMAIL,
  FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_ACCESS_TOKEN,
  isRoot,
  TIMEZONE,
  whatsappEnabled,
} from './config.js';
import { BlueskyChannel } from './channels/bluesky/index.js';
import { DiscordChannel } from './channels/discord.js';
import { EmailChannel } from './channels/email.js';
import { FacebookChannel } from './channels/facebook/index.js';
import { MastodonChannel } from './channels/mastodon/index.js';
import { RedditChannel } from './channels/reddit/index.js';
import { TelegramChannel } from './channels/telegram.js';
import { TwitterChannel } from './channels/twitter/index.js';
import { WebChannel } from './channels/web.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { startWebProxy } from './web-proxy.js';
import {
  ContainerOutput,
  runContainerCommand,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  addRoute,
  clearChatErrored,
  deleteSession,
  enqueueSystemMessage,
  flushSystemMessages,
  getAllChats,
  getAllGroupConfigs,
  getAllSessions,
  getAllTasks,
  getDefaultTarget,
  getDirectChildGroupCount,
  getGroupByFolder,
  getJidToFolderMap,
  getJidsThatNeedTrigger,
  hasAlwaysOnRoute,
  getJidsForFolder,
  getMessagesSince,
  getRoutedJids,
  getNewMessages,
  getRecentSessions,
  getRouterState,
  getRoutesForJid,
  GroupConfig,
  initDatabase,
  isChatErrored,
  markChatErrored,
  setGroupConfig,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { AttachmentDownloader, RawAttachment } from './mime.js';
import { enqueueEnrichment, waitForEnrichments } from './mime-enricher.js';
import {
  formatDiaryXml,
  readDiaryEntries,
  writeRecoveryEntry,
} from './diary.js';
import chatidCommand from './commands/chatid.js';
import { putCommand, getCommand, lsCommand } from './commands/file.js';
import newCommand, { pendingCommandArgs } from './commands/new.js';
import pingCommand from './commands/ping.js';
import stopCommand, { setStopDeps } from './commands/stop.js';
import {
  findCommand,
  registerCommand,
  writeCommandsXml,
} from './commands/index.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import {
  clockXml,
  findChannel,
  formatMessages,
  formatOutbound,
  isAuthorizedRoutingTarget,
  resolveRoute,
} from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage } from './types.js';
import { logger } from './logger.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let groups: Record<string, GroupConfig> = {};
let jidToFolder: Record<string, string> = {};
let jidsTrigger: Set<string> = new Set();
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;
const lastMessageDate: Record<string, string> = {};

const channels: Channel[] = [];
const queue = new GroupQueue();

// Per-group typing indicator intervals
const typingState: Record<
  string,
  { interval: ReturnType<typeof setInterval>; channel: Channel }
> = {};

function startTyping(channel: Channel, jid: string): void {
  stopTypingFor(jid);
  channel.setTyping?.(jid, true);
  if (channel.setTyping) {
    typingState[jid] = {
      interval: setInterval(() => {
        channel.setTyping!(jid, true).catch(() => {});
      }, 4000),
      channel,
    };
  }
}

function stopTypingFor(jid: string): void {
  const s = typingState[jid];
  if (!s) return;
  clearInterval(s.interval);
  s.channel.setTyping?.(jid, false);
  delete typingState[jid];
}

// Cache attachment data for /file put — keyed by message ID, TTL 60s
const attachmentCache = new Map<
  string,
  { attachments: RawAttachment[]; download: AttachmentDownloader; ts: number }
>();
const ATTACHMENT_CACHE_TTL = 60_000;

function pruneAttachmentCache(): void {
  const now = Date.now();
  for (const [k, v] of attachmentCache) {
    if (now - v.ts > ATTACHMENT_CACHE_TTL) attachmentCache.delete(k);
  }
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn(
      { raw: agentTs?.slice(0, 100) },
      'Corrupted last_agent_timestamp in DB, resetting',
    );
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  groups = getAllGroupConfigs();
  jidToFolder = getJidToFolderMap();
  jidsTrigger = getJidsThatNeedTrigger();
  logger.info(
    {
      groupCount: Object.keys(groups).length,
      jidCount: Object.keys(jidToFolder).length,
    },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

/** Refresh groups and routes from DB, close orphaned containers */
function refreshGroups(): void {
  const freshGroups = getAllGroupConfigs();
  const freshJidMap = getJidToFolderMap();
  const removedJids = Object.keys(jidToFolder).filter(
    (jid) => !freshJidMap[jid],
  );
  for (const jid of removedJids) {
    logger.info({ jid }, 'Route removed, closing container');
    queue.closeStdin(jid);
  }
  groups = freshGroups;
  jidToFolder = freshJidMap;
  jidsTrigger = getJidsThatNeedTrigger();
}

function registerGroup(jid: string, group: GroupConfig): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  // Store group config (folder-keyed)
  groups[group.folder] = group;
  setGroupConfig(group);

  // Add default route (JID -> folder)
  if (!jidToFolder[jid]) {
    jidToFolder[jid] = group.folder;
    addRoute(jid, {
      seq: 0,
      type: 'default',
      match: null,
      target: group.folder,
    });
  }

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const routedJids = new Set(Object.keys(jidToFolder));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: routedJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setGroups(
  g: Record<string, GroupConfig>,
  j2f: Record<string, string>,
): void {
  groups = g;
  jidToFolder = j2f;
}

/** @internal - exported for testing */
export const _processGroupMessages = processGroupMessages;

/** @internal - exported for testing */
export function _pushChannel(ch: Channel): void {
  channels.push(ch);
}

/** @internal - exported for testing */
export function _setLastMessageDate(folder: string, date: string): void {
  lastMessageDate[folder] = date;
}

/** @internal - exported for testing */
export function _getLastAgentTimestamp(jid: string): string {
  return lastAgentTimestamp[jid] ?? '';
}

/** @internal - exported for testing */
export const _delegateToChild = delegateToChild;
export const _delegateToParent = delegateToParent;

/** @internal - exported for testing */
export function _clearTestState(): void {
  sessions = {};
  for (const k of Object.keys(lastMessageDate)) delete lastMessageDate[k];
  for (const k of Object.keys(lastAgentTimestamp)) delete lastAgentTimestamp[k];
  channels.splice(0);
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const t0 = Date.now();
  const traceId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const folder = jidToFolder[chatJid];
  const group = folder ? groups[folder] : undefined;
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'no channel owns JID, skipping messages');
    return true;
  }

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-root groups, check if trigger is required and present
  if (!isRoot(group.folder) && jidsTrigger.has(chatJid)) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  // Apply flat routing rules before spawning agent.
  const lastMsg = missedMessages[missedMessages.length - 1];
  const routes = getRoutesForJid(chatJid);
  const target = resolveRoute(lastMsg, routes);
  if (target && target !== group.folder) {
    const formatted = formatMessages(missedMessages);
    const prevCursor = lastAgentTimestamp[chatJid] || '';
    lastAgentTimestamp[chatJid] = lastMsg.timestamp;
    saveState();
    delegateToChild(target, formatted, chatJid, 0).catch((err) => {
      // Don't roll back cursor - message is marked as processed but failed.
      // Parent can still fetch it via MCP message history tools.
      logger.error(
        { chatJid, target, err: String(err) },
        'routing failed, message dropped',
      );
    });
    return true;
  }

  // IMPORTANT: This message tells the agent which session transcript to read.
  // The agent is instructed (CLAUDE.md, SKILL.md) to ALWAYS read the .jl file
  // matching the session_id before responding. This prevents "no access to
  // history" claims — the .jl files ARE accessible via Read tool.
  if (!sessions[group.folder]) {
    const prev = getRecentSessions(group.folder, 2);
    const body = prev
      .map((s) => {
        let el =
          `  <previous_session id="${s.session_id}"` +
          ` started="${s.started_at}"`;
        if (s.ended_at) el += ` ended="${s.ended_at}"`;
        if (s.message_count != null) el += ` msgs="${s.message_count}"`;
        el += ` result="${s.result ?? 'unknown'}"`;
        if (s.error)
          el += ` error="${s.error.replace(/"/g, '&quot;').slice(0, 200)}"`;
        return el + '/>';
      })
      .join('\n');
    enqueueSystemMessage(group.folder, {
      origin: 'gateway',
      event: 'new-session',
      body: prev.length > 0 ? `\n${body}\n` : '',
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  if (
    lastMessageDate[group.folder] !== undefined &&
    lastMessageDate[group.folder] !== today
  ) {
    enqueueSystemMessage(group.folder, {
      origin: 'gateway',
      event: 'new-day',
      body: '',
    });
  }
  lastMessageDate[group.folder] = today;

  // Flush pending system messages (prepended to stdin)
  const sysXml = flushSystemMessages(group.folder);

  // Consume any pending args stashed by /new
  const pendingArgs = pendingCommandArgs.get(chatJid);
  if (pendingArgs) pendingCommandArgs.delete(chatJid);

  await waitForEnrichments(missedMessages.map((m) => m.id));
  const userMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );
  const formatted = formatMessages(userMessages);
  const clock = clockXml(TIMEZONE);
  const prompt =
    clock +
    '\n' +
    (sysXml ? sysXml + '\n' : '') +
    (pendingArgs ? pendingArgs + '\n' : '') +
    formatted;

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length, traceId },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  startTyping(channel, chatJid);
  let hadError = false;
  let outputSentToUser = false;
  let output: 'success' | 'error';

  try {
    output = await runAgent(
      group,
      prompt,
      chatJid,
      missedMessages.length,
      channel.name,
      async (result) => {
        // Streaming output callback — called for each agent result
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
          const text = raw
            .replace(/<internal>[\s\S]*?<\/internal>/g, '')
            .trim();
          logger.info(
            { group: group.name },
            `Agent output: ${raw.slice(0, 200)}`,
          );
          if (text) {
            await channel.sendMessage(chatJid, text);
            outputSentToUser = true;
          }
          resetIdleTimer();
        }

        if (result.status === 'success') {
          // Agent finished responding — stop typing indicator.
          // Container stays alive (idle) but should not show as "working".
          stopTypingFor(chatJid);
          queue.notifyIdle(chatJid);
        }

        if (result.status === 'error') {
          hadError = true;
        }
      },
    );
  } finally {
    stopTypingFor(chatJid);
    clearTimeout(idleTimer ?? undefined);
  }

  const dur = Date.now() - t0;
  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name, traceId, dur },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so messages are re-delivered on next retry.
    // Data is in DB — we just need the cursor to point before them.
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    markChatErrored(chatJid);
    logger.warn(
      { group: group.name, traceId, dur },
      'Agent error, rolled back cursor (awaiting user retry)',
    );
    channel
      .sendMessage(chatJid, 'Something went wrong. Please try again.')
      .catch((err) =>
        logger.warn({ chatJid, err }, 'Failed to send error notification'),
      );
    return true;
  }

  logger.info({ group: group.name, traceId, dur }, 'Messages processed');
  return true;
}

function spawnGroupFromPrototype(
  targetFolder: string,
): (GroupConfig & { jid: string }) | undefined {
  const slash = targetFolder.lastIndexOf('/');
  if (slash < 0) return undefined;
  const parentFolder = targetFolder.slice(0, slash);
  const parent = groups[parentFolder];
  if (!parent) return undefined;

  const max = parent.maxChildren ?? 50;
  if (max === 0) return undefined;
  const n = Object.values(groups).filter(
    (g) => g.parent === parentFolder,
  ).length;
  if (n >= max) {
    logger.warn({ parentFolder, n, max }, 'max_children reached');
    return undefined;
  }

  const parentPath = resolveGroupFolderPath(parentFolder);
  const prototypePath = path.join(parentPath, 'prototype');
  if (!fs.existsSync(prototypePath)) {
    logger.warn(
      { parentFolder, targetFolder },
      'no prototype dir, spawn refused',
    );
    return undefined;
  }
  const childPath = resolveGroupFolderPath(targetFolder);
  fs.mkdirSync(childPath, { recursive: true });
  for (const entry of fs.readdirSync(prototypePath)) {
    fs.copyFileSync(
      path.join(prototypePath, entry),
      path.join(childPath, entry),
    );
  }

  const jid = `spawn:${targetFolder}`;
  const group: GroupConfig = {
    name: targetFolder.split('/').pop()!,
    folder: targetFolder,
    added_at: new Date().toISOString(),
    parent: parentFolder,
  };
  groups[targetFolder] = group;
  setGroupConfig(group);
  jidToFolder[jid] = targetFolder;
  addRoute(jid, { seq: 0, type: 'default', match: null, target: targetFolder });
  logger.info({ parentFolder, targetFolder }, 'spawned child group');
  return { ...group, jid };
}

async function delegateToGroup(
  targetFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
  label: string,
): Promise<void> {
  let target: GroupConfig | undefined = groups[targetFolder];
  if (!target) {
    const spawned = spawnGroupFromPrototype(targetFolder);
    if (!spawned) throw new Error(`unknown ${label} group: ${targetFolder}`);
    target = spawned;
  }

  const channel = findChannel(channels, originJid);
  if (!channel) throw new Error(`no channel for origin JID: ${originJid}`);

  startTyping(channel, originJid);

  const taskId = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  queue.enqueueTask(targetFolder, taskId, async () => {
    const output = await runContainerCommand(
      target,
      {
        prompt,
        sessionId: sessions[target.folder],
        groupFolder: target.folder,
        chatJid: originJid,
        channelName: channel.name,
        messageCount: 1,
        delegateDepth: depth,
      },
      (proc, containerName) =>
        queue.registerProcess(targetFolder, proc, containerName, target.folder),
      async (result) => {
        if (result.newSessionId) {
          sessions[target.folder] = result.newSessionId;
          setSession(target.folder, result.newSessionId);
        }
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          const text = formatOutbound(raw);
          if (text) await channel.sendMessage(originJid, text);
        }
      },
    );

    if (output.newSessionId) {
      sessions[target.folder] = output.newSessionId;
      setSession(target.folder, output.newSessionId);
    }
    stopTypingFor(originJid);
    if (output.status === 'error') {
      logger.warn(
        { targetFolder, label, error: output.error },
        `${label} agent error`,
      );
    }
  });
}

function delegateToChild(
  childFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
): Promise<void> {
  return delegateToGroup(childFolder, prompt, originJid, depth, 'delegate');
}

function delegateToParent(
  parentFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
): Promise<void> {
  return delegateToGroup(parentFolder, prompt, originJid, depth, 'escalate');
}

async function runAgent(
  group: GroupConfig,
  prompt: string,
  chatJid: string,
  messageCount: number,
  channelName?: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (root group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    availableGroups,
    new Set(Object.keys(jidToFolder)),
  );

  // Inject diary summaries on session start (no existing session)
  const annotations: string[] = [];
  if (!sessionId) {
    const diary = formatDiaryXml(readDiaryEntries(group.folder));
    if (diary) annotations.push(diary);
  }

  // Preempt idle container if another JID owns this folder (cross-channel routing)
  queue.preemptFolderIfNeeded(group.folder, chatJid);

  try {
    const output = await runContainerCommand(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        assistantName: ASSISTANT_NAME,
        messageCount,
        channelName,
        _annotations: annotations.length > 0 ? annotations : undefined,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      onOutput,
    );

    if (output.status === 'error') {
      logger.error(
        { group: group.name, sessionId, error: output.error },
        'Container agent error',
      );
      writeRecoveryEntry(group.folder, 'error', output.error);
      // Evict if no progress was made (newSessionId same as input or absent)
      if (!output.newSessionId || output.newSessionId === sessionId) {
        delete sessions[group.folder];
        deleteSession(group.folder);
        logger.warn(
          { group: group.name, sessionId },
          'Evicted corrupted session',
        );
      } else {
        sessions[group.folder] = output.newSessionId;
        setSession(group.folder, output.newSessionId);
      }
      return 'error';
    }

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    return 'success';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeRecoveryEntry(group.folder, 'container_crash', msg);
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      // Refresh groups from DB (closes orphaned containers for removed routes)
      refreshGroups();

      const jids = Object.keys(jidToFolder);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const folder = jidToFolder[chatJid];
          const group = folder ? groups[folder] : undefined;
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'no channel owns JID, skipping messages');
            continue;
          }

          const needsTrigger =
            !isRoot(group.folder) && jidsTrigger.has(chatJid);

          // Intercept command messages before routing to agent
          const nonCommandMessages: NewMessage[] = [];
          for (const msg of groupMessages) {
            const m = msg.content.trim();
            // Strip leading media placeholder (e.g. "[Document: file.txt] /put")
            const cmdText = m.startsWith('[')
              ? m.replace(/^\[[^\]]*\]\s*/, '')
              : m;
            if (cmdText.startsWith('/')) {
              const [word, ...rest] = cmdText.slice(1).split(/\s+/);
              const handler = findCommand(word.toLowerCase());
              if (handler) {
                const cached = attachmentCache.get(msg.id);
                try {
                  await handler.handle({
                    group,
                    groupJid: chatJid,
                    message: msg,
                    channel,
                    args: rest.join(' '),
                    clearSession: (folder) => {
                      delete sessions[folder];
                      deleteSession(folder);
                    },
                    attachments: cached?.attachments,
                    download: cached?.download,
                  });
                } catch (err) {
                  logger.error({ command: word, err }, 'Command handler error');
                }
                if (cached) attachmentCache.delete(msg.id);
                // Advance cursor past the command message
                if (msg.timestamp > (lastAgentTimestamp[chatJid] || '')) {
                  lastAgentTimestamp[chatJid] = msg.timestamp;
                  saveState();
                }
                // Enqueue so system messages + pending args can flush
                clearChatErrored(chatJid);
                queue.enqueueMessageCheck(chatJid);
                continue;
              }
            }
            nonCommandMessages.push(msg);
          }

          if (nonCommandMessages.length === 0) continue;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = nonCommandMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Apply flat routing rules.
          {
            const lastMsg = nonCommandMessages[nonCommandMessages.length - 1];
            const routes = getRoutesForJid(chatJid);
            const target = resolveRoute(lastMsg, routes);
            if (target && target !== group.folder) {
              await waitForEnrichments(nonCommandMessages.map((m) => m.id));
              const allForRoute = getMessagesSince(
                chatJid,
                lastAgentTimestamp[chatJid] || '',
                ASSISTANT_NAME,
              );
              const toDelegate =
                allForRoute.length > 0 ? allForRoute : nonCommandMessages;
              const routedPrompt = formatMessages(toDelegate);
              const prevCursor = lastAgentTimestamp[chatJid] || '';
              lastAgentTimestamp[chatJid] =
                toDelegate[toDelegate.length - 1].timestamp;
              saveState();
              delegateToChild(target, routedPrompt, chatJid, 0).catch((err) => {
                // Don't roll back cursor - message is marked as processed but failed.
                // Parent can still fetch it via MCP message history tools.
                logger.error(
                  { chatJid, target, err: String(err) },
                  'routing failed, message dropped',
                );
              });
              continue;
            }
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          await waitForEnrichments(messagesToSend.map((m) => m.id));
          // Re-fetch after enrichment so voice/video content is included
          const enriched = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const formatted = formatMessages(
            enriched.length > 0 ? enriched : messagesToSend,
          );

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            clearChatErrored(chatJid);
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            startTyping(channel, chatJid);
          } else {
            // No active container — enqueue for a new one
            clearChatErrored(chatJid);
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err, chatJid: 'loop' }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, folder] of Object.entries(jidToFolder)) {
    const group = groups[folder];
    if (!group) continue;
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0 && !isChatErrored(chatJid)) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function initCommands(): void {
  registerCommand(newCommand);
  registerCommand(pingCommand);
  registerCommand(stopCommand);
  registerCommand(chatidCommand);
  registerCommand(putCommand);
  registerCommand(getCommand);
  registerCommand(lsCommand);
  setStopDeps({ closeStdin: (jid) => queue.closeStdin(jid) });
}

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  cleanupOrphans(CONTAINER_IMAGE);
  initDatabase();
  logger.info('Database initialized');
  loadState();
  initCommands();
  for (const group of Object.values(groups)) {
    writeCommandsXml(group.folder);
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (
      _chatJid: string,
      msg: NewMessage,
      attachments?: RawAttachment[],
      download?: AttachmentDownloader,
    ) => {
      storeMessage(msg);
      const folder = jidToFolder[msg.chat_jid];
      const group = folder ? groups[folder] : undefined;
      if (attachments && download && group) {
        // Resolve routing to determine final target folder for media storage
        const routes = getRoutesForJid(msg.chat_jid);
        const targetFolder = resolveRoute(msg, routes) || group.folder;

        enqueueEnrichment(msg.id, targetFolder, attachments, download);
        // Cache for /file put command — command interception reads from DB later
        attachmentCache.set(msg.id, {
          attachments,
          download,
          ts: Date.now(),
        });
        pruneAttachmentCache();
      }
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    isRoutedJid: (jid: string) => getDefaultTarget(jid) !== null,
    hasAlwaysOnGroup: () => hasAlwaysOnRoute(),
  };

  // Create and connect channels
  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    channels.push(telegram);
    await telegram.connect();
  }

  if (whatsappEnabled()) {
    const whatsapp = new WhatsAppChannel(channelOpts);
    channels.push(whatsapp);
    await whatsapp.connect();
  }

  if (DISCORD_BOT_TOKEN) {
    const discord = new DiscordChannel(DISCORD_BOT_TOKEN, channelOpts);
    channels.push(discord);
    await discord.connect();
  }

  if (EMAIL_IMAP_HOST) {
    const email = new EmailChannel(channelOpts);
    channels.push(email);
    await email.connect();
  }

  if (MASTODON_ACCESS_TOKEN) {
    const masto = new MastodonChannel(
      {
        instanceUrl: MASTODON_INSTANCE_URL,
        accessToken: MASTODON_ACCESS_TOKEN,
      },
      channelOpts,
    );
    channels.push(masto);
    await masto.connect();
  }

  if (BLUESKY_IDENTIFIER && BLUESKY_PASSWORD) {
    const bsky = new BlueskyChannel(
      {
        identifier: BLUESKY_IDENTIFIER,
        password: BLUESKY_PASSWORD,
        serviceUrl: BLUESKY_SERVICE_URL || undefined,
      },
      channelOpts,
    );
    channels.push(bsky);
    await bsky.connect();
  }

  if (REDDIT_CLIENT_ID) {
    const reddit = new RedditChannel(
      {
        clientId: REDDIT_CLIENT_ID,
        clientSecret: REDDIT_CLIENT_SECRET,
        username: REDDIT_USERNAME,
        password: REDDIT_PASSWORD,
        userAgent: `kanipi:1.0 (by /u/${REDDIT_USERNAME})`,
      },
      channelOpts,
    );
    channels.push(reddit);
    await reddit.connect();
  }

  if (TWITTER_USERNAME) {
    const twitter = new TwitterChannel(
      {
        username: TWITTER_USERNAME,
        password: TWITTER_PASSWORD,
        email: TWITTER_EMAIL,
      },
      channelOpts,
    );
    channels.push(twitter);
    await twitter.connect();
  }

  if (FACEBOOK_PAGE_ID) {
    const fb = new FacebookChannel(
      { pageId: FACEBOOK_PAGE_ID, pageAccessToken: FACEBOOK_PAGE_ACCESS_TOKEN },
      channelOpts,
    );
    channels.push(fb);
    await fb.connect();
  }

  if (WEB_PORT) {
    const web = new WebChannel();
    channels.push(web);
    await web.connect();
    startWebProxy({
      webPort: WEB_PORT,
      vitePort: VITE_PORT_INTERNAL,
      slothUsers: SLOTH_USERS,
      onMessage: channelOpts.onMessage,
      authSecret: process.env.AUTH_SECRET,
      webPublic: WEB_PUBLIC,
    });
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    getGroupConfig: getGroupByFolder,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'no channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    sendDocument: (jid, filePath, filename) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      if (!channel.sendDocument) {
        logger.warn(
          { jid, channel: channel.name },
          'sendDocument not supported by channel, skipping',
        );
        return Promise.resolve();
      }
      return channel.sendDocument(jid, filePath, filename);
    },
    getDefaultTarget,
    getJidsForFolder,
    getRoutedJids,
    getGroupConfig: getGroupByFolder,
    getDirectChildGroupCount,
    registerGroup,
    clearSession: (groupFolder) => {
      delete sessions[groupFolder];
      deleteSession(groupFolder);
    },
    syncGroupMetadata: (force) => {
      const wa = channels.find((c) => c.name === 'whatsapp') as
        | WhatsAppChannel
        | undefined;
      return wa?.syncGroupMetadata(force) ?? Promise.resolve();
    },
    getAvailableGroups,
    writeGroupsSnapshot,
    delegateToChild,
    delegateToParent,
  });
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
