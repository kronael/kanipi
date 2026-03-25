import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import {
  ASSISTANT_NAME,
  CONTAINER_IMAGE,
  DISCORD_BOT_TOKEN,
  DISCORD_USER_TOKEN,
  EMAIL_IMAP_HOST,
  POLL_INTERVAL,
  TELEGRAM_BOT_TOKEN,
  VITE_PORT_INTERNAL,
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
  REDDIT_SUBREDDITS,
  TWITTER_USERNAME,
  TWITTER_PASSWORD,
  TWITTER_EMAIL,
  FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_ACCESS_TOKEN,
  ONBOARDING_ENABLED,
  TIMEZONE,
  whatsappEnabled,
  permissionTier,
} from './config.js';
import { BlueskyChannel } from './channels/bluesky/index.js';
import { DiscordChannel } from './channels/discord.js';
import { EmailChannel } from './channels/email.js';
import { LocalChannel } from './channels/local.js';
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
  getSession,
  enqueueSystemMessage,
  flushSystemMessages,
  getAllChats,
  getAllGroupConfigs,
  getAllSessions,
  getAllTasks,
  getHubForJid,
  getDirectChildGroupCount,
  getGroupByFolder,
  getJidsForFolder,
  getMessagesSince,
  getRoutedJids,
  getUnroutedChatJids,
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
  setMessageTopic,
  storeChatMetadata,
  storeMessage,
  storeOutbound,
} from './db.js';
import { AttachmentDownloader, RawAttachment } from './mime.js';
import { enqueueEnrichment, waitForEnrichments } from './mime-enricher.js';
import {
  formatDiaryXml,
  readDiaryEntries,
  writeRecoveryEntry,
} from './diary.js';
import { readEpisodeEntries, formatEpisodeXml } from './episode.js';
import chatidCommand from './commands/chatid.js';
import { putCommand, getCommand, lsCommand } from './commands/file.js';
import newCommand, { pendingCommandArgs } from './commands/new.js';
import pingCommand from './commands/ping.js';
import statusCommand from './commands/status.js';
import stopCommand, { setStopDeps } from './commands/stop.js';
import approveCommand, { setApproveDeps } from './commands/approve.js';
import rejectCommand from './commands/reject.js';
import { setNotifyChannels } from './commands/notify.js';
import {
  findCommand,
  registerCommand,
  writeCommandsXml,
} from './commands/index.js';
import {
  accumulate,
  checkTimeout,
  defaultConfig,
  emptyState,
  ImpulseState,
} from './impulse.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import {
  clockXml,
  escapeXml,
  findChannel,
  formatMessages,
  resolveRoute,
  userContextXml,
} from './router.js';
import { handleOnboarding } from './onboarding.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, InboundEvent } from './types.js';
import { logger } from './logger.js';

const GITIGNORE_RUNTIME_DIRS = new Set([
  'diary',
  'episodes',
  'users',
  'logs',
  'media',
  'tmp',
]);

function ensureGroupGitRepo(groupDir: string): void {
  if (fs.existsSync(path.join(groupDir, '.git'))) return;
  try {
    execFileSync('git', ['init', groupDir], { stdio: 'pipe' });
  } catch {
    return; // git may not be available; non-fatal
  }
  const gitignorePath = path.join(groupDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    const lines = [
      'diary/',
      'episodes/',
      'users/',
      'logs/',
      'media/',
      'tmp/',
      '*.jl',
    ];
    try {
      for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !GITIGNORE_RUNTIME_DIRS.has(entry.name)) {
          lines.push(`${entry.name}/`);
        }
      }
    } catch {
      // ignore
    }
    fs.writeFileSync(gitignorePath, lines.join('\n') + '\n');
  }
}

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let groups: Record<string, GroupConfig> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;
const lastMessageDate: Record<string, string> = {};

const SOCIAL_PLATFORMS = new Set([
  'twitter',
  'mastodon',
  'bluesky',
  'reddit',
  'facebook',
  'instagram',
  'threads',
  'linkedin',
  'twitch',
  'youtube',
]);

function isSocialJid(jid: string): boolean {
  const prefix = jid.split(':')[0];
  return SOCIAL_PLATFORMS.has(prefix);
}

const channels: Channel[] = [];
const impulseStates = new Map<string, ImpulseState>();
const impulseConfig = defaultConfig();
const queue = new GroupQueue();

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
  logger.info(
    {
      groupCount: Object.keys(groups).length,
      jidCount: getRoutedJids().length,
    },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function refreshGroups(): void {
  groups = getAllGroupConfigs();
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

  groups[group.folder] = group;
  setGroupConfig(group);

  addRoute(jid, {
    seq: 0,
    type: 'default',
    match: null,
    target: group.folder,
  });

  const tier = permissionTier(group.folder);
  if (tier <= 2) {
    const existing = getRoutesForJid(jid).map((r) => r.match);
    if (!existing.includes('@')) {
      addRoute(jid, {
        seq: -2,
        type: 'prefix',
        match: '@',
        target: group.folder,
      });
    }
    if (!existing.includes('#')) {
      addRoute(jid, {
        seq: -1,
        type: 'prefix',
        match: '#',
        target: group.folder,
      });
    }
  }

  const localJid = `local:${group.folder}`;
  const existingLocal = getRoutesForJid(localJid);
  if (existingLocal.length === 0) {
    addRoute(localJid, {
      seq: 0,
      type: 'default',
      match: null,
      target: group.folder,
    });
  }

  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  ensureGroupGitRepo(groupDir);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const routedJids = new Set(getRoutedJids());

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: routedJids.has(c.jid),
    }));
}

export function _setGroups(g: Record<string, GroupConfig>): void {
  groups = g;
}

export const _processGroupMessages = processGroupMessages;

export function _pushChannel(ch: Channel): void {
  channels.push(ch);
}

export function _setLastMessageDate(folder: string, date: string): void {
  lastMessageDate[folder] = date;
}

export function _getLastAgentTimestamp(jid: string): string {
  return lastAgentTimestamp[jid] ?? '';
}

export const _delegateToChild = delegateToChild;
export const _delegateToParent = delegateToParent;

export function _clearTestState(): void {
  sessions = {};
  for (const k of Object.keys(lastMessageDate)) delete lastMessageDate[k];
  for (const k of Object.keys(lastAgentTimestamp)) delete lastAgentTimestamp[k];
  channels.splice(0);
  impulseStates.clear();
}

async function processGroupMessages(chatJid: string): Promise<boolean> {
  const t0 = Date.now();
  const traceId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const folder = chatJid.startsWith('local:')
    ? chatJid.slice(6)
    : getHubForJid(chatJid);
  const group = folder ? groups[folder] : undefined;
  if (!group) {
    logger.warn({ chatJid, folder }, 'No group for JID');
    return true;
  }

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID');
    return true;
  }

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) {
    logger.info({ group: group.name, sinceTimestamp }, 'No pending messages');
    return true;
  }

  if (isChatErrored(chatJid)) {
    logger.info({ group: group.name }, 'Chat errored, skipping');
    return true;
  }

  // Skip command messages — they are handled by the message loop.
  // Advance the cursor past any leading commands to avoid double-processing.
  const nonCmdMessages = missedMessages.filter((msg) => {
    const m = msg.content.trim();
    let cmdText = m.startsWith('[') ? m.replace(/^\[[^\]]*\]\s*/, '') : m;
    cmdText = cmdText.replace(/^@\S+\s+/, '');
    if (!cmdText.startsWith('/')) return true;
    const [word] = cmdText.slice(1).split(/\s+/);
    return !findCommand(word.toLowerCase());
  });
  if (nonCmdMessages.length === 0) {
    // All pending messages are gateway commands; advance cursor.
    const last = missedMessages[missedMessages.length - 1];
    if (last.timestamp > (lastAgentTimestamp[chatJid] || '')) {
      lastAgentTimestamp[chatJid] = last.timestamp;
      saveState();
    }
    logger.info({ group: group.name }, 'All pending are commands, skip agent');
    return true;
  }

  const lastMsg = nonCmdMessages[nonCmdMessages.length - 1];
  const routes = getRoutesForJid(chatJid);
  const resolved = resolveRoute(lastMsg, routes);
  if (resolved && resolved.target !== group.folder) {
    logger.info(
      {
        group: group.name,
        target: resolved.target,
        count: missedMessages.length,
      },
      'Delegating messages',
    );
    lastAgentTimestamp[chatJid] = lastMsg.timestamp;
    saveState();
    delegatePerSender(
      nonCmdMessages,
      resolved.target,
      chatJid,
      resolved.command,
    );
    return true;
  }

  if (!sessions[group.folder]) {
    const prev = getRecentSessions(group.folder, 3);
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

  const sysXml = flushSystemMessages(group.folder);

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
  const groupDir = resolveGroupFolderPath(group.folder);
  const lastSender = userMessages[userMessages.length - 1]?.sender;
  const userXml = lastSender ? userContextXml(lastSender, groupDir) : null;
  const prompt =
    clock +
    '\n' +
    (userXml ? userXml + '\n' : '') +
    (sysXml ? sysXml + '\n' : '') +
    (pendingArgs ? pendingArgs + '\n' : '') +
    formatted;

  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length, traceId },
    'Processing messages',
  );

  startTyping(channel, chatJid);
  let hadError = false;
  let outputSentToUser = false;
  let output: 'success' | 'error';
  let lastSentId: string | undefined = lastMsg.id;

  try {
    output = await runAgent(
      group,
      prompt,
      chatJid,
      missedMessages.length,
      channel.name,
      userMessages[userMessages.length - 1]?.id,
      async (result) => {
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          const text = raw.trim();
          logger.info(
            { group: group.name },
            `Agent output: ${raw.slice(0, 200)}`,
          );
          if (text) {
            const sentId = await channel.sendMessage(
              chatJid,
              text,
              lastSentId ? { replyTo: lastSentId } : undefined,
            );
            storeOutbound({
              chatJid,
              content: text,
              source: 'agent',
              groupFolder: group.folder,
              replyToId: lastSentId,
              platformMsgId: sentId,
            });
            if (sentId) lastSentId = sentId;
            outputSentToUser = true;
          }
        }

        if (result.status === 'success') {
          if (result.result?.startsWith('⏳')) {
            // Interim status update — keep typing, don't signal idle yet.
            // Calling notifyIdle here would prematurely preempt the container
            // if IPC tasks are pending.
          } else {
            // Final result (text or empty) — stop typing and signal idle.
            stopTypingFor(chatJid);
            queue.notifyIdle(chatJid);
          }
        }

        if (result.status === 'error') {
          hadError = true;
        }
      },
    );
  } finally {
    stopTypingFor(chatJid);
  }

  const dur = Date.now() - t0;
  if (output === 'error' || hadError) {
    if (outputSentToUser) {
      logger.warn(
        { group: group.name, traceId, dur },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
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

  if (!outputSentToUser) {
    logger.warn(
      { group: group.name, traceId, dur },
      'Agent completed with no output sent to user (empty final result)',
    );
  }

  logger.info({ group: group.name, traceId, dur }, 'Messages processed');
  return true;
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    entry.isDirectory() ? copyDirRecursive(s, d) : fs.copyFileSync(s, d);
  }
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
  copyDirRecursive(prototypePath, childPath);

  const jid = `spawn:${targetFolder}`;
  const group: GroupConfig = {
    name: targetFolder.split('/').pop()!,
    folder: targetFolder,
    added_at: new Date().toISOString(),
    parent: parentFolder,
  };
  groups[targetFolder] = group;
  setGroupConfig(group);
  addRoute(jid, { seq: 0, type: 'default', match: null, target: targetFolder });
  logger.info({ parentFolder, targetFolder }, 'spawned child group');
  return { ...group, jid };
}

interface EscalationOrigin {
  jid: string;
  messageId?: string;
}

async function delegateToGroup(
  targetFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
  label: string,
  messageId?: string,
  escalationOrigin?: EscalationOrigin,
  command?: string | null,
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

  const rawCmd = command ? ['bash', '-c', command] : undefined;

  queue.enqueueTask(targetFolder, taskId, async () => {
    let lastSentId = messageId;
    try {
      const onResult = async (result: ContainerOutput) => {
        if (result.newSessionId) {
          sessions[target.folder] = result.newSessionId;
          setSession(target.folder, result.newSessionId);
        }
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          let text = raw.trim();
          if (text) {
            if (escalationOrigin) {
              const msgAttr = escalationOrigin.messageId
                ? ` origin_msg_id="${escapeXml(escalationOrigin.messageId)}"`
                : '';
              text =
                `<escalation_response origin_jid="${escapeXml(escalationOrigin.jid)}"${msgAttr}>\n` +
                `${text}\n</escalation_response>`;
            }
            const sentId = await channel.sendMessage(
              originJid,
              text,
              lastSentId ? { replyTo: lastSentId } : undefined,
            );
            storeOutbound({
              chatJid: originJid,
              content: text,
              source: 'agent',
              groupFolder: targetFolder,
              replyToId: lastSentId,
              platformMsgId: sentId,
            });
            if (sentId) lastSentId = sentId;
          }
        }
      };

      const output = await runContainerCommand(
        target,
        rawCmd
          ? prompt
          : {
              prompt,
              sessionId: sessions[target.folder],
              groupFolder: target.folder,
              chatJid: originJid,
              channelName: channel.name,
              messageCount: 1,
              delegateDepth: depth,
              messageId,
            },
        (proc, containerName) =>
          queue.registerProcess(
            targetFolder,
            proc,
            containerName,
            target.folder,
          ),
        rawCmd ? undefined : onResult,
        rawCmd,
      );

      // For raw commands, send output as a message
      if (rawCmd && output.result) {
        await onResult(output);
      }

      if (output.newSessionId) {
        sessions[target.folder] = output.newSessionId;
        setSession(target.folder, output.newSessionId);
      }
      if (output.status === 'error') {
        logger.warn(
          { targetFolder, label, error: output.error },
          `${label} agent error`,
        );
      }
    } finally {
      stopTypingFor(originJid);
    }
  });
}

function delegateToChild(
  childFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
  messageId?: string,
  command?: string | null,
): Promise<void> {
  return delegateToGroup(
    childFolder,
    prompt,
    originJid,
    depth,
    'delegate',
    messageId,
    undefined,
    command,
  );
}

function delegateToParent(
  parentFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
  messageId?: string,
  escalationOrigin?: EscalationOrigin,
): Promise<void> {
  return delegateToGroup(
    parentFolder,
    prompt,
    originJid,
    depth,
    'escalate',
    messageId,
    escalationOrigin,
  );
}

function delegatePerSender(
  messages: InboundEvent[],
  target: string,
  chatJid: string,
  command?: string | null,
): void {
  const bySender = new Map<string, InboundEvent[]>();
  for (const m of messages) {
    const existing = bySender.get(m.sender);
    if (existing) existing.push(m);
    else bySender.set(m.sender, [m]);
  }
  for (const senderMsgs of bySender.values()) {
    const formatted = formatMessages(senderMsgs);
    const last = senderMsgs[senderMsgs.length - 1];
    delegateToChild(target, formatted, chatJid, 0, last.id, command).catch(
      (err) => {
        logger.error(
          { chatJid, target, err: String(err) },
          'routing failed, message dropped',
        );
      },
    );
  }
}

async function runAgent(
  group: GroupConfig,
  prompt: string,
  chatJid: string,
  messageCount: number,
  channelName?: string,
  messageId?: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  topic = '',
): Promise<'success' | 'error'> {
  const sessionId = topic
    ? getSession(group.folder, topic)
    : sessions[group.folder];

  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      command: t.command,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(group.folder, availableGroups);

  const annotations: string[] = [];
  if (!sessionId) {
    const diary = formatDiaryXml(readDiaryEntries(group.folder));
    if (diary) annotations.push(diary);
    const episodes = formatEpisodeXml(readEpisodeEntries(group.folder));
    if (episodes) annotations.push(episodes);
  }

  queue.preemptFolderIfNeeded(group.folder, chatJid);

  let outputDelivered = false;
  const wrappedOnOutput = onOutput
    ? async (result: ContainerOutput) => {
        await onOutput(result);
        if (result.result) outputDelivered = true;
      }
    : undefined;

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
        messageId,
        _annotations: annotations.length > 0 ? annotations : undefined,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.status === 'error') {
      logger.error(
        { group: group.name, sessionId, error: output.error },
        'Container agent error',
      );
      writeRecoveryEntry(group.folder, 'error', output.error);
      // Evict only if no progress was made AND no output was sent to the user.
      // If output was delivered, the session made progress — evicting would
      // discard a working session and force a cold restart.
      if (
        !outputDelivered &&
        (!output.newSessionId || output.newSessionId === sessionId)
      ) {
        if (topic) {
          deleteSession(group.folder, topic);
        } else {
          delete sessions[group.folder];
          deleteSession(group.folder);
        }
        logger.warn(
          { group: group.name, sessionId },
          'Evicted corrupted session',
        );
      } else {
        if (topic) {
          setSession(group.folder, output.newSessionId ?? sessionId!, topic);
        } else {
          sessions[group.folder] = output.newSessionId ?? sessionId!;
          setSession(group.folder, output.newSessionId ?? sessionId!);
        }
      }
      return 'error';
    }

    if (output.newSessionId) {
      if (topic) {
        setSession(group.folder, output.newSessionId, topic);
      } else {
        sessions[group.folder] = output.newSessionId;
        setSession(group.folder, output.newSessionId);
      }
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

  logger.info(`NanoClaw running (@${ASSISTANT_NAME})`);

  while (true) {
    try {
      refreshGroups();

      const jids = getRoutedJids();
      if (ONBOARDING_ENABLED) {
        jids.push(...getUnroutedChatJids(lastTimestamp));
      }
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        lastTimestamp = newTimestamp;
        saveState();

        const messagesByGroup = new Map<string, InboundEvent[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const folder = chatJid.startsWith('local:')
            ? chatJid.slice(6)
            : getHubForJid(chatJid);
          const group = folder ? groups[folder] : undefined;
          if (!group) {
            if (ONBOARDING_ENABLED) {
              const channel = findChannel(channels, chatJid);
              if (channel) {
                await handleOnboarding(chatJid, groupMessages, channel);
              }
            } else {
              logger.warn({ chatJid, folder }, 'No group for JID, skipping');
            }
            continue;
          }

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'no channel owns JID, skipping messages');
            continue;
          }

          // impulse gate: social platforms accumulate; messaging passes through
          if (isSocialJid(chatJid)) {
            let iState = impulseStates.get(chatJid) ?? emptyState();
            let shouldFlush = false;
            for (const m of groupMessages) {
              const r = accumulate(iState, m, impulseConfig);
              iState = r.state;
              if (r.flush) shouldFlush = true;
            }
            impulseStates.set(chatJid, iState);
            if (!shouldFlush) {
              logger.info(
                { group: group.name, impulse: iState.impulse },
                'Impulse held',
              );
              continue;
            }
            impulseStates.delete(chatJid);
          }

          type DeferredCmd = { msg: InboundEvent; word: string; args: string };
          const deferredCmds: DeferredCmd[] = [];
          const nonCommandMessages: InboundEvent[] = [];
          for (const msg of groupMessages) {
            const m = msg.content.trim();
            // Strip leading media placeholder (e.g. "[Document: file.txt] /put")
            // then strip routing prefix (e.g. "@root /approve" → "/approve")
            let cmdText = m.startsWith('[')
              ? m.replace(/^\[[^\]]*\]\s*/, '')
              : m;
            cmdText = cmdText.replace(/^@\S+\s+/, '');
            if (cmdText.startsWith('/')) {
              const [word, ...rest] = cmdText.slice(1).split(/\s+/);
              if (findCommand(word.toLowerCase())) {
                deferredCmds.push({ msg, word, args: rest.join(' ') });
                continue;
              }
            }
            nonCommandMessages.push(msg);
          }

          {
            const candidateMsgs =
              nonCommandMessages.length > 0
                ? nonCommandMessages
                : groupMessages;
            const lastMsg = candidateMsgs[candidateMsgs.length - 1];
            const routes = getRoutesForJid(chatJid);
            const resolved = resolveRoute(lastMsg, routes);
            const routedGroup =
              resolved && groups[resolved.target]
                ? groups[resolved.target]
                : group;

            for (const { msg, word, args } of deferredCmds) {
              const handler = findCommand(word.toLowerCase())!;
              const cached = attachmentCache.get(msg.id);
              try {
                await handler.handle({
                  group: routedGroup,
                  groupJid: chatJid,
                  message: msg,
                  channel,
                  args,
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
              if (msg.timestamp > (lastAgentTimestamp[chatJid] || '')) {
                lastAgentTimestamp[chatJid] = msg.timestamp;
                saveState();
              }
              clearChatErrored(chatJid);
              queue.enqueueMessageCheck(chatJid);
            }

            if (nonCommandMessages.length === 0) {
              logger.info(
                { group: group.name, commands: deferredCmds.length },
                'All messages were commands, skip agent',
              );
              continue;
            }

            // Handle @agent and #topic routing — match anywhere in message.
            if (/@\w/.test(lastMsg.content)) {
              const m = lastMsg.content.match(/@(\w[\w-]*)/);
              if (m) {
                const childFolder = `${resolved?.target ?? group.folder}/${m[1]}`;
                const childGroup = groups[childFolder];
                if (childGroup) {
                  const stripped = lastMsg.content
                    .replace(/@\w[\w-]*/, '')
                    .trim();
                  lastAgentTimestamp[chatJid] = lastMsg.timestamp;
                  saveState();
                  await waitForEnrichments(
                    nonCommandMessages.map((msg) => msg.id),
                  );
                  delegateToChild(
                    childFolder,
                    stripped,
                    chatJid,
                    0,
                    lastMsg.id,
                  ).catch((err) => {
                    logger.error(
                      { chatJid, childFolder, err: String(err) },
                      '@agent routing failed',
                    );
                  });
                  continue;
                }
                // child not found — fall through to normal self-processing
                logger.debug(
                  { group: group.name, childFolder },
                  '@agent child not found, routing to self',
                );
              }
              // unparseable @prefix or missing child — fall through
            }

            if (/#\w/.test(lastMsg.content)) {
              const m = lastMsg.content.match(/#(\w[\w-]*)/);
              if (m) {
                const topicName = m[1];
                const stripped = lastMsg.content
                  .replace(/#\w[\w-]*/, '')
                  .trim();
                setMessageTopic(lastMsg.id, topicName);
                lastAgentTimestamp[chatJid] = lastMsg.timestamp;
                saveState();
                await waitForEnrichments(
                  nonCommandMessages.map((msg) => msg.id),
                );
                queue.enqueueMessageCheck(chatJid);
                if (channel) startTyping(channel, chatJid);
                const taskId = `topic-${topicName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                queue.enqueueTask(group.folder, taskId, async () => {
                  let lastSentId: string | undefined = lastMsg.id;
                  try {
                    await runAgent(
                      group,
                      stripped,
                      chatJid,
                      1,
                      channel?.name,
                      lastMsg.id,
                      async (result) => {
                        if (result.result) {
                          const raw =
                            typeof result.result === 'string'
                              ? result.result
                              : JSON.stringify(result.result);
                          const text = raw.trim();
                          if (text && channel) {
                            const sentId = await channel.sendMessage(
                              chatJid,
                              text,
                              lastSentId ? { replyTo: lastSentId } : undefined,
                            );
                            storeOutbound({
                              chatJid,
                              content: text,
                              source: 'agent',
                              groupFolder: group.folder,
                              replyToId: lastSentId,
                              platformMsgId: sentId,
                              topic: topicName,
                            });
                            if (sentId) lastSentId = sentId;
                          }
                        }
                      },
                      topicName,
                    );
                  } finally {
                    if (channel) stopTypingFor(chatJid);
                  }
                });
                continue;
              }
              // unparseable #prefix — fall through to normal self-processing
              logger.debug(
                { group: group.name, content: lastMsg.content.slice(0, 40) },
                '#topic prefix not parseable, routing to self',
              );
            }

            if (resolved && resolved.target !== group.folder) {
              logger.info(
                {
                  group: group.name,
                  target: resolved.target,
                  count: nonCommandMessages.length,
                },
                'Delegating messages',
              );
              await waitForEnrichments(nonCommandMessages.map((m) => m.id));
              const allForRoute = getMessagesSince(
                chatJid,
                lastAgentTimestamp[chatJid] || '',
                ASSISTANT_NAME,
              );
              const toDelegate =
                allForRoute.length > 0 ? allForRoute : nonCommandMessages;
              lastAgentTimestamp[chatJid] =
                toDelegate[toDelegate.length - 1].timestamp;
              saveState();
              delegatePerSender(
                toDelegate,
                resolved.target,
                chatJid,
                resolved.command,
              );
              continue;
            }
          }

          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          await waitForEnrichments(messagesToSend.map((m) => m.id));
          const enriched = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const formatted = formatMessages(
            enriched.length > 0 ? enriched : messagesToSend,
          );

          if (queue.sendMessage(chatJid, formatted)) {
            logger.info(
              { group: group.name, count: messagesToSend.length },
              'Piped to active container',
            );
            clearChatErrored(chatJid);
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            startTyping(channel, chatJid);
          } else {
            clearChatErrored(chatJid);
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err, chatJid: 'loop' }, 'Error in message loop');
    }
    for (const [jid, state] of impulseStates) {
      if (checkTimeout(state, impulseConfig)) {
        impulseStates.delete(jid);
        queue.enqueueMessageCheck(jid);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function recoverPendingMessages(): void {
  for (const chatJid of getRoutedJids()) {
    const folder = getHubForJid(chatJid);
    if (!folder) continue;
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
  registerCommand(statusCommand);
  registerCommand(approveCommand);
  registerCommand(rejectCommand);
  setStopDeps({ closeStdin: (jid) => queue.closeStdin(jid) });
  setApproveDeps({ registerGroup, getGroup: (folder) => groups[folder] });
}

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  cleanupOrphans(CONTAINER_IMAGE);
  initDatabase();
  loadState();
  initCommands();
  for (const group of Object.values(groups)) {
    writeCommandsXml(group.folder);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const channelOpts = {
    onMessage: (
      _chatJid: string,
      msg: InboundEvent,
      attachments?: RawAttachment[],
      download?: AttachmentDownloader,
    ) => {
      storeMessage(msg);
      if (!msg.is_from_me && !msg.is_bot_message) {
        clearChatErrored(msg.chat_jid);
      }
      const folder = getHubForJid(msg.chat_jid);
      const group = folder ? groups[folder] : undefined;
      if (attachments && download && group) {
        const routes = getRoutesForJid(msg.chat_jid);
        const targetFolder = resolveRoute(msg, routes)?.target || group.folder;
        enqueueEnrichment(msg.id, targetFolder, attachments, download);
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
  };

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

  if (DISCORD_USER_TOKEN || DISCORD_BOT_TOKEN) {
    const discord = new DiscordChannel(
      DISCORD_USER_TOKEN || DISCORD_BOT_TOKEN,
      channelOpts,
      !!DISCORD_USER_TOKEN,
    );
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
      REDDIT_SUBREDDITS,
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
      onMessage: channelOpts.onMessage,
      authSecret: process.env.AUTH_SECRET,
      webPublic: WEB_PUBLIC,
      dashCtx: { queue, channels },
    });
  }

  channels.push(new LocalChannel());
  setNotifyChannels(channels);

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
        return undefined;
      }
      const text = rawText.trim();
      if (text) {
        const sentId = await channel.sendMessage(jid, text);
        storeOutbound({
          chatJid: jid,
          content: text,
          source: 'scheduler',
        });
        return sentId;
      }
      return undefined;
    },
  });
  startIpcWatcher({
    sendMessage: async (jid, text, opts) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      const sentId = await channel.sendMessage(jid, text, opts);
      storeOutbound({
        chatJid: jid,
        content: text,
        source: 'ipc',
        replyToId: opts?.replyTo,
        platformMsgId: sentId,
      });
      return sentId;
    },
    sendDocument: async (jid, filePath, filename) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      if (!channel.sendDocument) {
        logger.warn(
          { jid, channel: channel.name },
          'sendDocument not supported by channel, skipping',
        );
        return;
      }
      await channel.sendDocument(jid, filePath, filename);
      storeOutbound({
        chatJid: jid,
        content: `[file: ${filename || path.basename(filePath)}]`,
        source: 'ipc',
      });
    },
    getHubForJid,
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
