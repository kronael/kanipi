import fs from 'fs';
import path from 'path';

import { loadConfig, initConfig, getAssistantName, getTriggerPattern, getIdleTimeout, MAIN_GROUP_FOLDER, ArizukaConfig } from './config.js';
import { createChannels, findChannel } from './channels/index.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { cleanupOrphans, ensureContainerRuntimeRunning } from './container-runtime.js';
import { initCredentials } from './credentials.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getUnregisteredChatsWithMessages,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { parseBindings, resolveRoute } from './wire.js';
import { parseRoutes } from './tap.js';
import { Channel, NewMessage, RegisteredGroup, Route, Binding } from './types.js';
import { logger } from './logger.js';

let _config: ArizukaConfig;

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info({ groupCount: Object.keys(registeredGroups).length }, 'State loaded');
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
    logger.warn({ jid, folder: group.folder, err }, 'Rejecting group registration with invalid folder');
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  logger.info({ jid, name: group.name, folder: group.folder }, 'Group registered');
}

/**
 * Auto-register an unknown chat JID. Creates a group folder derived from the JID,
 * assigns the default agent, and skips trigger requirement so the agent responds
 * to every message (like a "main" group).
 */
function autoRegisterChat(chatJid: string, channelName: string): RegisteredGroup | null {
  if (!_config.autoRegister) return null;

  // Derive a safe folder name from the JID
  const safeName = chatJid
    .replace(/^tg:/, 'tg-')
    .replace(/@.*$/, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase()
    .slice(0, 40);

  const folder = safeName || `auto-${Date.now()}`;
  const group: RegisteredGroup = {
    name: `${channelName}:${chatJid}`,
    folder,
    trigger: `@${getAssistantName()}`,
    added_at: new Date().toISOString(),
    requiresTrigger: false,
  };

  registerGroup(chatJid, group);
  return group;
}

function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
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

async function processGroupMessages(
  chatJid: string,
  bindings: Binding[],
  defaultAgent: string,
): Promise<boolean> {
  let group = registeredGroups[chatJid];

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping');
    return true;
  }

  // Auto-register unknown chats if enabled
  if (!group) {
    group = autoRegisterChat(chatJid, channel.name) ?? undefined as any;
    if (!group) return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
  const assistantName = getAssistantName();
  const triggerPattern = getTriggerPattern();

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const missedMessages = getMessagesSince(chatJid, sinceTimestamp, assistantName);

  if (missedMessages.length === 0) return true;

  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) => triggerPattern.test(m.content.trim()));
    if (!hasTrigger) return true;
  }

  // Resolve route via wire
  const route = resolveRoute(bindings, { channel: channel.name, peerId: chatJid }, defaultAgent);
  logger.info(
    { chatJid, agent: route.agentId, matchedBy: route.matchedBy },
    'Routed message',
  );

  const prompt = formatMessages(missedMessages);

  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info({ group: group.name, messageCount: missedMessages.length }, 'Processing messages');

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const idleTimeout = getIdleTimeout();

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      queue.closeStdin(chatJid);
    }, idleTimeout);
  };

  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, route.agentId, async (result) => {
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      resetIdleTimer();
    }

    if (result.status === 'success') queue.notifyIdle(chatJid);
    if (result.status === 'error') hadError = true;
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Error after output sent, skipping cursor rollback');
      return true;
    }
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  agentId: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];
  const assistantName = getAssistantName();

  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder, isMain,
    tasks.map((t) => ({
      id: t.id, groupFolder: t.group_folder, prompt: t.prompt,
      schedule_type: t.schedule_type, schedule_value: t.schedule_value,
      status: t.status, next_run: t.next_run,
    })),
  );

  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder, isMain, availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      { prompt, sessionId, groupFolder: group.folder, chatJid, isMain, assistantName, agentId },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Container agent error');
      return 'error';
    }
    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(
  bindings: Binding[],
  defaultAgent: string,
): Promise<void> {
  if (messageLoopRunning) return;
  messageLoopRunning = true;

  const assistantName = getAssistantName();
  const triggerPattern = getTriggerPattern();
  const POLL_INTERVAL = 2000;

  logger.info(`Arizuka running (trigger: @${assistantName})`);

  while (true) {
    try {
      // Auto-register unknown chats that have new messages
      if (_config.autoRegister) {
        const registeredJids = new Set(Object.keys(registeredGroups));
        const unknownJids = getUnregisteredChatsWithMessages(registeredJids, lastTimestamp);
        for (const jid of unknownJids) {
          const ch = findChannel(channels, jid);
          if (ch) autoRegisterChat(jid, ch.name);
        }
      }

      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, assistantName);

      if (messages.length > 0) {
        lastTimestamp = newTimestamp;
        saveState();

        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) existing.push(msg);
          else messagesByGroup.set(msg.chat_jid, [msg]);
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          let group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) => triggerPattern.test(m.content.trim()));
            if (!hasTrigger) continue;
          }

          const allPending = getMessagesSince(
            chatJid, lastAgentTimestamp[chatJid] || '', assistantName,
          );
          const messagesToSend = allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            lastAgentTimestamp[chatJid] = messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            channel.setTyping?.(chatJid, true)?.catch(() => {});
          } else {
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

function recoverPendingMessages(): void {
  const assistantName = getAssistantName();
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, assistantName);
    if (pending.length > 0) {
      logger.info({ group: group.name, pendingCount: pending.length }, 'Recovery: found unprocessed messages');
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

async function main(): Promise<void> {
  // 1. Load config
  const config = loadConfig();
  _config = config;
  initConfig(config);
  logger.info({
    name: config.assistant.name,
    agents: Object.keys(config.agents),
    autoRegister: config.autoRegister,
  }, 'Config loaded');

  // 2. Container runtime
  ensureContainerRuntimeRunning();
  cleanupOrphans();

  // 3. Database
  initDatabase();
  logger.info('Database initialized');

  // 4. Credentials
  initCredentials(config.credentials ?? {});

  // 5. Wire + Tap
  const bindings = parseBindings(config.bindings ?? []);
  const routes = parseRoutes(config.routes ?? []);
  logger.info({ bindingCount: bindings.length, routeCount: routes.length }, 'Wire bindings and tap routes parsed');

  // 6. State
  loadState();

  // 7. Shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // 8. Channels
  const channelCallbacks = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (
      chatJid: string, timestamp: string, name?: string,
      channel?: string, isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  const connectedChannels = await createChannels(config, channelCallbacks);
  channels.push(...connectedChannels);
  logger.info({ channelCount: channels.length }, 'Channels connected');

  // 9. Scheduler
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) return;
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });

  // 10. IPC watcher (with tap routes for policy enforcement)
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    tapRoutes: routes.length > 0 ? routes : undefined,
    syncGroupMetadata: async (force) => {
      const wa = channels.find((c) => c.name === 'whatsapp');
      if (wa && 'syncGroupMetadata' in wa) {
        await (wa as any).syncGroupMetadata(force);
      }
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
  });

  // 11. Queue processor
  queue.setProcessMessagesFn((chatJid) =>
    processGroupMessages(chatJid, bindings, config.assistant.defaultAgent),
  );

  // 12. Recovery + main loop
  recoverPendingMessages();
  startMessageLoop(bindings, config.assistant.defaultAgent).catch((err) => {
    logger.fatal({ err }, 'Message loop crashed');
    process.exit(1);
  });
}

const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start Arizuka');
    process.exit(1);
  });
}
