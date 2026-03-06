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
  isRoot,
  whatsappEnabled,
} from './config.js';
import { DiscordChannel } from './channels/discord.js';
import { EmailChannel } from './channels/email.js';
import { TelegramChannel } from './channels/telegram.js';
import { WebChannel } from './channels/web.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { startWebProxy } from './web-proxy.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeActionManifest,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
} from './container-runtime.js';
import {
  deleteSession,
  enqueueSystemMessage,
  flushSystemMessages,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRecentSessions,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { AttachmentDownloader, RawAttachment } from './mime.js';
import { enqueueEnrichment, waitForEnrichments } from './mime-enricher.js';
import chatidCommand from './commands/chatid.js';
import newCommand, { pendingCommandArgs } from './commands/new.js';
import pingCommand from './commands/ping.js';
import {
  findCommand,
  registerCommand,
  writeCommandsXml,
} from './commands/index.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import {
  findChannel,
  formatMessages,
  formatOutbound,
  isAuthorizedRoutingTarget,
  resolveRoutingTarget,
} from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;
const lastMessageDate: Record<string, string> = {};

const channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
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

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

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
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
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
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
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
  if (!isRoot(group.folder) && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  // Apply routing rules on the latest message before spawning parent agent.
  const rules = group.routingRules ?? [];
  if (rules.length > 0) {
    const lastMsg = missedMessages[missedMessages.length - 1];
    const target = resolveRoutingTarget(lastMsg, rules);
    if (target) {
      if (!isAuthorizedRoutingTarget(group.folder, target)) {
        logger.warn(
          { chatJid, source: group.folder, target },
          'routing auth denied: not direct parent→child or cross-world',
        );
      } else {
        const formatted = formatMessages(missedMessages);
        const prevCursor = lastAgentTimestamp[chatJid] || '';
        lastAgentTimestamp[chatJid] = lastMsg.timestamp;
        saveState();
        delegateToChild(target, formatted, chatJid, 0).catch((err) => {
          lastAgentTimestamp[chatJid] = prevCursor;
          saveState();
          logger.error(
            { chatJid, target, err },
            'processGroupMessages delegate error',
          );
        });
        return true;
      }
    }
  }

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
  const prompt =
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
    { group: group.name, messageCount: missedMessages.length },
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

  await channel.setTyping?.(chatJid, true);
  let typingInterval: ReturnType<typeof setInterval> | null = channel.setTyping
    ? setInterval(() => channel.setTyping!(chatJid, true), 4000)
    : null;
  let hadError = false;
  let outputSentToUser = false;

  const stopTyping = () => {
    if (!typingInterval) return;
    clearInterval(typingInterval);
    typingInterval = null;
    channel.setTyping?.(chatJid, false);
  };

  const output = await runAgent(
    group,
    prompt,
    chatJid,
    missedMessages.length,
    async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
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
        stopTyping();
        queue.notifyIdle(chatJid);
      }

      if (result.status === 'error') {
        hadError = true;
      }
    },
  );

  stopTyping();
  clearTimeout(idleTimer ?? undefined);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Tell user to retry — don't auto-retry (error is likely permanent)
    logger.warn(
      { group: group.name },
      'Agent error, advancing cursor (user told to retry)',
    );
    channel
      .sendMessage(chatJid, 'Something went wrong. Please try again.')
      .catch((err) =>
        logger.warn({ chatJid, err }, 'Failed to send error notification'),
      );
    return true;
  }

  return true;
}

async function delegateToChild(
  childFolder: string,
  prompt: string,
  originJid: string,
  depth: number,
): Promise<void> {
  const child = Object.values(registeredGroups).find(
    (g) => g.folder === childFolder,
  );
  if (!child) throw new Error(`unknown child group: ${childFolder}`);

  const channel = findChannel(channels, originJid);
  if (!channel) throw new Error(`no channel for origin JID: ${originJid}`);

  const taskId = `delegate-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  queue.enqueueTask(childFolder, taskId, async () => {
    writeActionManifest(child.folder);
    const output = await runContainerAgent(
      child,
      {
        prompt,
        sessionId: sessions[child.folder],
        groupFolder: child.folder,
        chatJid: originJid,
        messageCount: 1,
        delegateDepth: depth,
      },
      (proc, containerName) =>
        queue.registerProcess(childFolder, proc, containerName, child.folder),
      async (result) => {
        if (result.newSessionId) {
          sessions[child.folder] = result.newSessionId;
          setSession(child.folder, result.newSessionId);
        }
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          const text = raw
            .replace(/<internal>[\s\S]*?<\/internal>/g, '')
            .trim();
          if (text) await channel.sendMessage(originJid, formatOutbound(text));
        }
      },
    );

    if (output.newSessionId) {
      sessions[child.folder] = output.newSessionId;
      setSession(child.folder, output.newSessionId);
    }
    if (output.status === 'error') {
      logger.warn(
        { childFolder, error: output.error },
        'delegate child agent error',
      );
    }
  });
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  messageCount: number,
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
    new Set(Object.keys(registeredGroups)),
  );

  // Write action manifest for agent-side tool discovery
  writeActionManifest(group.folder);

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        assistantName: ASSISTANT_NAME,
        messageCount,
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
      const jids = Object.keys(registeredGroups);
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
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            console.log(
              `Warning: no channel owns JID ${chatJid}, skipping messages`,
            );
            continue;
          }

          const needsTrigger =
            !isRoot(group.folder) && group.requiresTrigger !== false;

          // Intercept command messages before routing to agent
          const nonCommandMessages: NewMessage[] = [];
          for (const msg of groupMessages) {
            const m = msg.content.trim();
            if (m.startsWith('/')) {
              const [word, ...rest] = m.slice(1).split(/\s+/);
              const handler = findCommand(word.toLowerCase());
              if (handler) {
                handler
                  .handle({
                    group,
                    groupJid: chatJid,
                    message: msg,
                    channel,
                    args: rest.join(' '),
                    clearSession: (folder) => {
                      delete sessions[folder];
                      deleteSession(folder);
                    },
                  })
                  .catch((err) =>
                    logger.error(
                      { command: word, err },
                      'Command handler error',
                    ),
                  );
                // Advance cursor past the command message
                if (msg.timestamp > (lastAgentTimestamp[chatJid] || '')) {
                  lastAgentTimestamp[chatJid] = msg.timestamp;
                  saveState();
                }
                // Enqueue so system messages + pending args can flush
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

          // Apply routing rules on the latest message.
          // First match routes to child group; parent skips.
          const rules = group.routingRules ?? [];
          if (rules.length > 0) {
            const lastMsg = nonCommandMessages[nonCommandMessages.length - 1];
            const target = resolveRoutingTarget(lastMsg, rules);
            if (target) {
              if (!isAuthorizedRoutingTarget(group.folder, target)) {
                logger.warn(
                  { chatJid, source: group.folder, target },
                  'routing auth denied: not direct parent→child or cross-world',
                );
              } else {
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
                delegateToChild(target, routedPrompt, chatJid, 0).catch(
                  (err) => {
                    lastAgentTimestamp[chatJid] = prevCursor;
                    saveState();
                    logger.error(
                      { chatJid, target, err },
                      'routing delegate error',
                    );
                  },
                );
                continue;
              }
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
          const formatted = formatMessages(
            getMessagesSince(
              chatJid,
              lastAgentTimestamp[chatJid] || '',
              ASSISTANT_NAME,
            ),
          );

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
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
  registerCommand(chatidCommand);
}

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  cleanupOrphans(CONTAINER_IMAGE);
  initDatabase();
  logger.info('Database initialized');
  loadState();
  initCommands();
  for (const group of Object.values(registeredGroups)) {
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
      const group = registeredGroups[msg.chat_jid];
      if (attachments && download && group) {
        enqueueEnrichment(msg.id, group.folder, attachments, download);
      }
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
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
    });
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        console.log(`Warning: no channel owns JID ${jid}, cannot send message`);
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
    registeredGroups: () => registeredGroups,
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
