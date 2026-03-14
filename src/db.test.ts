import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  _setRawGroupColumns,
  _setTestGroupRoute,
  addRoute,
  appendMessageContent,
  clearChatErrored,
  createAuthSession,
  createAuthUser,
  createTask,
  deleteAuthSession,
  deleteGroupConfig,
  deleteRoute,
  deleteSession,
  deleteTask,
  enqueueSystemMessage,
  flushSystemMessages,
  getAllChats,
  getAllGroupConfigs,
  getAllRoutes,
  getAllSessions,
  getAllTasks,
  getAuthSession,
  getAuthUserByUsername,
  getAuthUserBySub,
  getDirectChildGroupCount,
  getDueTasks,
  getEmailThread,
  getEmailThreadByMsgId,
  getGroupByFolder,
  getGroupBySlink,
  getHubForJid,
  getJidsForFolder,
  getLastGroupSync,
  getMessageById,
  getMessagesSince,
  getNewMessages,
  getRecentSessions,
  getRouteById,
  getRoutedJids,
  getRouteTargetsForJid,
  getRoutesForJid,
  getRouterState,
  getSession,
  getTaskById,
  getTasksForGroup,
  hasAlwaysOnRoute,
  isChatErrored,
  logTaskRun,
  markChatErrored,
  pruneExpiredSessions,
  recordSessionStart,
  setGroupConfig,
  setLastGroupSync,
  setRoutesForJid,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeEmailThread,
  storeMessage,
  updateChatName,
  updateSessionEnd,
  updateTask,
  updateTaskAfterRun,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized InboundEvent interface
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

// --- storeMessage (InboundEvent format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('filters out empty content', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Dave',
      content: '',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(0);
  });

  it('stores is_from_me flag', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-3',
      chat_jid: 'group@g.us',
      sender: 'me@s.whatsapp.net',
      sender_name: 'Me',
      content: 'my message',
      timestamp: '2024-01-01T00:00:05.000Z',
      is_from_me: true,
    });

    // Message is stored (we can retrieve it — is_from_me doesn't affect retrieval)
    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
  });

  it('upserts on duplicate id+chat_jid', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'original',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'updated',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('updated');
  });
});

// --- getMessagesSince ---

describe('getMessagesSince', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'm1',
      chat_jid: 'group@g.us',
      sender: 'Alice@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'first',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'm2',
      chat_jid: 'group@g.us',
      sender: 'Bob@s.whatsapp.net',
      sender_name: 'Bob',
      content: 'second',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'm3',
      chat_jid: 'group@g.us',
      sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot',
      content: 'bot reply',
      timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'm4',
      chat_jid: 'group@g.us',
      sender: 'Carol@s.whatsapp.net',
      sender_name: 'Carol',
      content: 'third',
      timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns messages after the given timestamp', () => {
    const msgs = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Should exclude m1, m2 (before/at timestamp), m3 (bot message)
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('third');
  });

  it('excludes bot messages via is_bot_message flag', () => {
    const msgs = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    const botMsgs = msgs.filter((m) => m.content === 'bot reply');
    expect(botMsgs).toHaveLength(0);
  });

  it('returns all non-bot messages when sinceTimestamp is empty', () => {
    const msgs = getMessagesSince('group@g.us', '', 'Andy');
    // 3 user messages (bot message excluded)
    expect(msgs).toHaveLength(3);
  });

  it('filters pre-migration bot messages via content prefix backstop', () => {
    // Simulate a message written before migration: has prefix but is_bot_message = 0
    store({
      id: 'm5',
      chat_jid: 'group@g.us',
      sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot',
      content: 'Andy: old bot reply',
      timestamp: '2024-01-01T00:00:05.000Z',
    });
    const msgs = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:04.000Z',
      'Andy',
    );
    expect(msgs).toHaveLength(0);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  beforeEach(() => {
    storeChatMetadata('group1@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group2@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'a1',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'g1 msg1',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'a2',
      chat_jid: 'group2@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'g2 msg1',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'a3',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'bot reply',
      timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'a4',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'g1 msg2',
      timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns new messages across multiple groups', () => {
    const { messages, newTimestamp } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    // Excludes bot message, returns 3 user messages
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:04.000Z');
  });

  it('filters by timestamp', () => {
    const { messages } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Only g1 msg2 (after ts, not bot)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('g1 msg2');
  });

  it('returns empty for no registered groups', () => {
    const { messages, newTimestamp } = getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });
});

// --- storeChatMetadata ---

describe('storeChatMetadata', () => {
  it('stores chat with JID as default name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('group@g.us');
    expect(chats[0].name).toBe('group@g.us');
  });

  it('stores chat with explicit name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'My Group');
    const chats = getAllChats();
    expect(chats[0].name).toBe('My Group');
  });

  it('updates name on subsequent call with name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Updated Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated Name');
  });

  it('preserves newer timestamp on conflict', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:05.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });
});

// --- Task CRUD ---

describe('task CRUD', () => {
  it('creates and retrieves a task', () => {
    createTask({
      id: 'task-1',
      group_folder: 'root',
      chat_jid: 'group@g.us',
      prompt: 'do something',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const task = getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('do something');
    expect(task!.status).toBe('active');
  });

  it('updates task status', () => {
    createTask({
      id: 'task-2',
      group_folder: 'root',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    updateTask('task-2', { status: 'paused' });
    expect(getTaskById('task-2')!.status).toBe('paused');
  });

  it('updateTask no-op leaves fields unchanged', () => {
    createTask({
      id: 'task-noop',
      group_folder: 'root',
      chat_jid: 'group@g.us',
      prompt: 'unchanged',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    updateTask('task-noop', {});

    const task = getTaskById('task-noop');
    expect(task!.prompt).toBe('unchanged');
    expect(task!.status).toBe('active');
    expect(task!.next_run).toBe('2024-06-01T00:00:00.000Z');
  });
});

// --- getDueTasks ---

describe('getDueTasks', () => {
  it('excludes tasks with null next_run', () => {
    createTask({
      id: 'task-paused',
      group_folder: 'root',
      chat_jid: 'group@g.us',
      prompt: 'paused task',
      schedule_type: 'cron',
      schedule_value: '0 * * * *',
      context_mode: 'isolated',
      next_run: null,
      status: 'paused',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const due = getDueTasks();
    expect(due.find((t) => t.id === 'task-paused')).toBeUndefined();
  });
});

// --- updateTaskAfterRun ---

describe('updateTaskAfterRun', () => {
  it('marks task completed when nextRun is null', () => {
    createTask({
      id: 'task-once',
      group_folder: 'root',
      chat_jid: 'group@g.us',
      prompt: 'run once',
      schedule_type: 'once',
      schedule_value: '2020-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: '2020-01-01T00:00:00Z',
      status: 'active',
      created_at: '2020-01-01T00:00:00Z',
    });

    updateTaskAfterRun('task-once', null, 'done');
    expect(getTaskById('task-once')!.status).toBe('completed');
  });
});

// --- setGroupConfig ---

describe('setGroupConfig', () => {
  it('throws on invalid folder path', () => {
    expect(() =>
      setGroupConfig({
        name: 'escape',
        folder: '../escape',
        added_at: '2024-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('stores and retrieves containerConfig', () => {
    _setTestGroupRoute('telegram:cc', {
      name: 'cfg',
      folder: 'cfg',
      containerConfig: { timeout: 60000 },
    });
    const g = getGroupByFolder('cfg');
    expect(g?.containerConfig?.timeout).toBe(60000);
  });

  it('throws on invalid containerConfig schema', () => {
    expect(() =>
      setGroupConfig({
        name: 'bad',
        folder: 'bad',
        added_at: '2024-01-01T00:00:00.000Z',
        // @ts-expect-error intentional bad data
        containerConfig: { timeout: 'not-a-number' },
      }),
    ).toThrow();
  });
});

// --- groups round-trip ---

describe('groups round-trip', () => {
  it('preserves containerConfig fields through set/get', () => {
    _setTestGroupRoute('telegram:full', {
      name: 'full',
      folder: 'full',
      containerConfig: {
        timeout: 120000,
        additionalMounts: [{ hostPath: '/srv/data', readonly: true }],
      },
    });
    const all = getAllGroupConfigs();
    const g = all['full'];
    expect(g?.containerConfig?.timeout).toBe(120000);
    expect(g?.containerConfig?.additionalMounts?.[0].hostPath).toBe(
      '/srv/data',
    );
  });
});

// --- groups malformed JSON fallback ---

describe('groups malformed JSON fallback', () => {
  it('returns undefined containerConfig for invalid JSON', () => {
    _setRawGroupColumns('bad-json-cc', {
      container_config: '{not valid json',
    });
    const g = getGroupByFolder('bad-json-cc');
    expect(g).toBeDefined();
    expect(g!.containerConfig).toBeUndefined();
  });

  it('returns undefined containerConfig for schema-invalid JSON', () => {
    _setRawGroupColumns('schema-cc', {
      container_config: JSON.stringify({ timeout: 'not-a-number' }),
    });
    const g = getGroupByFolder('schema-cc');
    expect(g).toBeDefined();
    expect(g!.containerConfig).toBeUndefined();
  });

  it('getAllGroupConfigs skips malformed fields without throwing', () => {
    _setRawGroupColumns('all-bad', {
      container_config: '{bad',
    });
    let all: Record<string, unknown> | undefined;
    expect(() => {
      all = getAllGroupConfigs();
    }).not.toThrow();
    expect(all!['all-bad']).toBeDefined();
  });
});

// --- pruneExpiredSessions ---

describe('pruneExpiredSessions', () => {
  it('runs without error on empty db', () => {
    expect(() => pruneExpiredSessions()).not.toThrow();
  });
});

// --- enqueueSystemMessage + flushSystemMessages ---

describe('system_messages', () => {
  it('enqueue inserts; flush returns XML containing body and clears queue', () => {
    enqueueSystemMessage('grp-a', { origin: 'gateway', body: 'hello world' });
    const xml = flushSystemMessages('grp-a');
    expect(xml).toContain('hello world');
    expect(xml).toContain('origin="gateway"');
    const xml2 = flushSystemMessages('grp-a');
    expect(xml2).toBe('');
  });

  it('returns empty string when no messages exist', () => {
    expect(flushSystemMessages('grp-empty')).toBe('');
  });

  it('scoping: messages for group A do not appear in group B flush', () => {
    enqueueSystemMessage('grp-a', { origin: 'gw', body: 'for A' });
    const xml = flushSystemMessages('grp-b');
    expect(xml).toBe('');
    const xmlA = flushSystemMessages('grp-a');
    expect(xmlA).toContain('for A');
  });

  it('includes event and attrs in XML when provided', () => {
    enqueueSystemMessage('grp-a', {
      origin: 'gw',
      event: 'new-session',
      attrs: { sessionId: 'abc123' },
      body: 'session started',
    });
    const xml = flushSystemMessages('grp-a');
    expect(xml).toContain('event="new-session"');
    expect(xml).toContain('sessionId="abc123"');
  });
});

// --- session_history ---

describe('session_history', () => {
  it('recordSessionStart + updateSessionEnd row appears in getRecentSessions', () => {
    recordSessionStart('row-1', 'grp-s', '2024-01-01T10:00:00.000Z');
    updateSessionEnd(
      'row-1',
      'sess-abc',
      '2024-01-01T10:05:00.000Z',
      'ok',
      undefined,
      3,
    );
    const rows = getRecentSessions('grp-s', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('sess-abc');
    expect(rows[0].result).toBe('ok');
    expect(rows[0].message_count).toBe(3);
    expect(rows[0].ended_at).toBe('2024-01-01T10:05:00.000Z');
  });

  it('bare recordSessionStart row does not appear (session_id IS NULL)', () => {
    recordSessionStart('row-bare', 'grp-s', '2024-01-01T09:00:00.000Z');
    const rows = getRecentSessions('grp-s', 10);
    expect(rows.find((r) => r.id === 'row-bare')).toBeUndefined();
  });

  it('updateSessionEnd stores error field', () => {
    recordSessionStart('row-err', 'grp-s', '2024-01-01T11:00:00.000Z');
    updateSessionEnd(
      'row-err',
      'sess-err',
      '2024-01-01T11:01:00.000Z',
      'error',
      'timeout',
      0,
    );
    const rows = getRecentSessions('grp-s', 10);
    const r = rows.find((x) => x.session_id === 'sess-err');
    expect(r).toBeDefined();
    expect(r!.result).toBe('error');
    expect(r!.error).toBe('timeout');
  });

  it('getRecentSessions respects limit', () => {
    for (let i = 0; i < 5; i++) {
      const ts = `2024-01-0${i + 1}T00:00:00.000Z`;
      recordSessionStart(`row-lim-${i}`, 'grp-lim', ts);
      updateSessionEnd(`row-lim-${i}`, `sess-lim-${i}`, ts, 'ok', undefined, 1);
    }
    expect(getRecentSessions('grp-lim', 3)).toHaveLength(3);
  });

  it('getRecentSessions orders most-recent-first', () => {
    recordSessionStart('row-o1', 'grp-ord', '2024-01-01T00:00:00.000Z');
    updateSessionEnd(
      'row-o1',
      'sess-o1',
      '2024-01-01T00:01:00.000Z',
      'ok',
      undefined,
      1,
    );
    recordSessionStart('row-o2', 'grp-ord', '2024-01-02T00:00:00.000Z');
    updateSessionEnd(
      'row-o2',
      'sess-o2',
      '2024-01-02T00:01:00.000Z',
      'ok',
      undefined,
      1,
    );
    const rows = getRecentSessions('grp-ord', 10);
    expect(rows[0].session_id).toBe('sess-o2');
    expect(rows[1].session_id).toBe('sess-o1');
  });
});

// --- updateChatName ---

describe('updateChatName', () => {
  it('creates a new chat entry if not exists', () => {
    updateChatName('new@g.us', 'New Chat');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('new@g.us');
    expect(chats[0].name).toBe('New Chat');
  });

  it('updates name without changing timestamp on existing chat', () => {
    storeChatMetadata('chat@g.us', '2024-06-01T00:00:00.000Z', 'Original');
    updateChatName('chat@g.us', 'Renamed');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Renamed');
    expect(chats[0].last_message_time).toBe('2024-06-01T00:00:00.000Z');
  });
});

// --- getLastGroupSync / setLastGroupSync ---

describe('group sync tracking', () => {
  it('getLastGroupSync returns null initially', () => {
    expect(getLastGroupSync()).toBeNull();
  });

  it('setLastGroupSync stores a timestamp retrievable by getLastGroupSync', () => {
    setLastGroupSync();
    const ts = getLastGroupSync();
    expect(ts).toBeTruthy();
    expect(new Date(ts!).getTime()).toBeGreaterThan(0);
  });
});

// --- chat error flag ---

describe('chat error flag', () => {
  it('isChatErrored returns false for unknown jid', () => {
    expect(isChatErrored('unknown@g.us')).toBe(false);
  });

  it('markChatErrored / clearChatErrored cycle', () => {
    storeChatMetadata('err@g.us', '2024-01-01T00:00:00.000Z');
    expect(isChatErrored('err@g.us')).toBe(false);
    markChatErrored('err@g.us');
    expect(isChatErrored('err@g.us')).toBe(true);
    clearChatErrored('err@g.us');
    expect(isChatErrored('err@g.us')).toBe(false);
  });
});

// --- appendMessageContent ---

describe('appendMessageContent', () => {
  it('appends text to existing message content', () => {
    storeChatMetadata('g@g.us', '2024-01-01T00:00:00.000Z');
    store({
      id: 'append-1',
      chat_jid: 'g@g.us',
      sender: 'u@s',
      sender_name: 'U',
      content: 'hello',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    appendMessageContent('append-1', ' world');
    const m = getMessageById('append-1');
    expect(m).toBeDefined();
    expect(m!.content).toBe('hello world');
  });

  it('no-op when message id does not exist', () => {
    // Should not throw
    appendMessageContent('nonexistent', ' extra');
  });
});

// --- getMessageById ---

describe('getMessageById', () => {
  it('returns stored message', () => {
    storeChatMetadata('g@g.us', '2024-01-01T00:00:00.000Z');
    store({
      id: 'by-id-1',
      chat_jid: 'g@g.us',
      sender: 'u@s',
      sender_name: 'U',
      content: 'found',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    const m = getMessageById('by-id-1');
    expect(m).toBeDefined();
    expect(m!.content).toBe('found');
  });

  it('returns undefined for missing id', () => {
    expect(getMessageById('missing')).toBeUndefined();
  });
});

// --- routerState ---

describe('routerState', () => {
  it('getRouterState returns undefined for missing key', () => {
    expect(getRouterState('nope')).toBeUndefined();
  });

  it('setRouterState stores and retrieves a value', () => {
    setRouterState('ts', '2024-01-01T00:00:00.000Z');
    expect(getRouterState('ts')).toBe('2024-01-01T00:00:00.000Z');
  });

  it('setRouterState overwrites existing key', () => {
    setRouterState('k', 'v1');
    setRouterState('k', 'v2');
    expect(getRouterState('k')).toBe('v2');
  });
});

// --- sessions ---

describe('sessions', () => {
  it('getSession returns undefined for missing group', () => {
    expect(getSession('nope')).toBeUndefined();
  });

  it('setSession stores and retrieves session id', () => {
    setSession('grp', 'sess-1');
    expect(getSession('grp')).toBe('sess-1');
  });

  it('deleteSession removes session', () => {
    setSession('grp', 'sess-1');
    deleteSession('grp');
    expect(getSession('grp')).toBeUndefined();
  });

  it('getAllSessions returns all sessions as record', () => {
    setSession('a', 'sa');
    setSession('b', 'sb');
    const all = getAllSessions();
    expect(all).toEqual({ a: 'sa', b: 'sb' });
  });

  it('getAllSessions returns empty object when none', () => {
    expect(getAllSessions()).toEqual({});
  });
});

// --- getTasksForGroup / getAllTasks ---

describe('task listing', () => {
  it('getTasksForGroup returns tasks for a specific group', () => {
    createTask({
      id: 't1',
      group_folder: 'grp-a',
      chat_jid: 'c@g.us',
      prompt: 'a',
      schedule_type: 'once',
      schedule_value: '2024-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
    });
    createTask({
      id: 't2',
      group_folder: 'grp-b',
      chat_jid: 'c@g.us',
      prompt: 'b',
      schedule_type: 'once',
      schedule_value: '2024-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
    });
    const tasks = getTasksForGroup('grp-a');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('t1');
  });

  it('getAllTasks returns all tasks', () => {
    createTask({
      id: 't1',
      group_folder: 'grp-a',
      chat_jid: 'c@g.us',
      prompt: 'a',
      schedule_type: 'once',
      schedule_value: '2024-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
    });
    createTask({
      id: 't2',
      group_folder: 'grp-b',
      chat_jid: 'c@g.us',
      prompt: 'b',
      schedule_type: 'once',
      schedule_value: '2024-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
    });
    expect(getAllTasks()).toHaveLength(2);
  });
});

// --- logTaskRun ---

describe('logTaskRun', () => {
  it('stores a task run log entry', () => {
    createTask({
      id: 'tlog-1',
      group_folder: 'root',
      chat_jid: 'c@g.us',
      prompt: 'x',
      schedule_type: 'once',
      schedule_value: '2024-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
    });
    // Should not throw
    logTaskRun({
      task_id: 'tlog-1',
      run_at: '2024-01-01T00:01:00Z',
      duration_ms: 500,
      status: 'success',
      result: 'done',
      error: null,
    });
  });

  it('deleteTask also removes run logs', () => {
    createTask({
      id: 'tlog-del',
      group_folder: 'root',
      chat_jid: 'c@g.us',
      prompt: 'x',
      schedule_type: 'once',
      schedule_value: '2024-01-01T00:00:00Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00Z',
    });
    logTaskRun({
      task_id: 'tlog-del',
      run_at: '2024-01-01T00:01:00Z',
      duration_ms: 100,
      status: 'success',
      result: null,
      error: null,
    });
    deleteTask('tlog-del');
    expect(getTaskById('tlog-del')).toBeUndefined();
  });
});

// --- auth ---

describe('auth users and sessions', () => {
  it('createAuthUser and retrieve by sub', () => {
    const user = createAuthUser('sub-1', 'alice', 'hash123', 'Alice');
    expect(user.sub).toBe('sub-1');
    expect(user.username).toBe('alice');
    const found = getAuthUserBySub('sub-1');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Alice');
  });

  it('getAuthUserByUsername finds user', () => {
    createAuthUser('sub-2', 'bob', 'hash456', 'Bob');
    const found = getAuthUserByUsername('bob');
    expect(found).toBeDefined();
    expect(found!.sub).toBe('sub-2');
  });

  it('getAuthUserBySub returns undefined for missing sub', () => {
    expect(getAuthUserBySub('missing')).toBeUndefined();
  });

  it('getAuthUserByUsername returns undefined for missing username', () => {
    expect(getAuthUserByUsername('missing')).toBeUndefined();
  });

  it('auth session CRUD', () => {
    createAuthUser('sub-s', 'sess-user', 'h', 'S');
    const expires = '2099-01-01T00:00:00.000Z';
    createAuthSession('tok-hash', 'sub-s', expires);
    const sess = getAuthSession('tok-hash');
    expect(sess).toBeDefined();
    expect(sess!.user_sub).toBe('sub-s');
    expect(sess!.expires_at).toBe(expires);

    deleteAuthSession('tok-hash');
    expect(getAuthSession('tok-hash')).toBeUndefined();
  });

  it('getAuthSession returns undefined for missing hash', () => {
    expect(getAuthSession('missing')).toBeUndefined();
  });

  it('pruneExpiredSessions removes expired sessions', () => {
    createAuthUser('sub-p', 'prune-user', 'h', 'P');
    createAuthSession('expired-tok', 'sub-p', '2000-01-01T00:00:00.000Z');
    createAuthSession('valid-tok', 'sub-p', '2099-01-01T00:00:00.000Z');
    pruneExpiredSessions();
    expect(getAuthSession('expired-tok')).toBeUndefined();
    expect(getAuthSession('valid-tok')).toBeDefined();
  });
});

// --- email threads ---

describe('email threads', () => {
  it('storeEmailThread and retrieve by threadId', () => {
    storeEmailThread('msg-1', 'thread-1', 'alice@ex.com', 'root-1');
    const t = getEmailThread('thread-1');
    expect(t).toBeDefined();
    expect(t!.from_address).toBe('alice@ex.com');
    expect(t!.root_msg_id).toBe('root-1');
  });

  it('getEmailThreadByMsgId retrieves by message_id', () => {
    storeEmailThread('msg-2', 'thread-2', 'bob@ex.com', 'root-2');
    const t = getEmailThreadByMsgId('msg-2');
    expect(t).toBeDefined();
    expect(t!.thread_id).toBe('thread-2');
  });

  it('returns undefined for missing thread', () => {
    expect(getEmailThread('missing')).toBeUndefined();
    expect(getEmailThreadByMsgId('missing')).toBeUndefined();
  });

  it('storeEmailThread ignores duplicate message_id', () => {
    storeEmailThread('dup-msg', 'thread-a', 'a@ex.com', 'root-a');
    storeEmailThread('dup-msg', 'thread-b', 'b@ex.com', 'root-b');
    const t = getEmailThreadByMsgId('dup-msg');
    // INSERT OR IGNORE keeps the first
    expect(t!.thread_id).toBe('thread-a');
  });
});

// --- routes ---

describe('routes CRUD', () => {
  it('addRoute and getRoutesForJid', () => {
    const id = addRoute('tg:1', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'root',
    });
    expect(id).toBeGreaterThan(0);
    const routes = getRoutesForJid('tg:1');
    expect(routes).toHaveLength(1);
    expect(routes[0].target).toBe('root');
    expect(routes[0].type).toBe('default');
  });

  it('getRouteById returns route or undefined', () => {
    const id = addRoute('tg:2', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'root',
    });
    expect(getRouteById(id)).toBeDefined();
    expect(getRouteById(999999)).toBeUndefined();
  });

  it('deleteRoute removes a route', () => {
    const id = addRoute('tg:3', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'root',
    });
    deleteRoute(id);
    expect(getRouteById(id)).toBeUndefined();
  });

  it('setRoutesForJid replaces all routes for a JID', () => {
    addRoute('tg:4', { seq: 0, type: 'default', match: null, target: 'old' });
    setRoutesForJid('tg:4', [
      { seq: 0, type: 'command', match: '/code', target: 'code' },
      { seq: 1, type: 'default', match: null, target: 'new' },
    ]);
    const routes = getRoutesForJid('tg:4');
    expect(routes).toHaveLength(2);
    expect(routes[0].target).toBe('code');
    expect(routes[1].target).toBe('new');
  });

  it('getAllRoutes returns routes across JIDs', () => {
    addRoute('tg:5', { seq: 0, type: 'default', match: null, target: 'a' });
    addRoute('dc:1', { seq: 0, type: 'default', match: null, target: 'b' });
    const all = getAllRoutes();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('getRoutedJids returns distinct JIDs', () => {
    addRoute('tg:6', { seq: 0, type: 'default', match: null, target: 'a' });
    addRoute('tg:6', { seq: 1, type: 'command', match: '/x', target: 'b' });
    addRoute('dc:2', { seq: 0, type: 'default', match: null, target: 'c' });
    const jids = getRoutedJids();
    expect(jids).toContain('tg:6');
    expect(jids).toContain('dc:2');
    // tg:6 should appear only once
    expect(jids.filter((j) => j === 'tg:6')).toHaveLength(1);
  });

  it('getJidsForFolder returns JIDs routing to a folder', () => {
    addRoute('tg:7', { seq: 0, type: 'default', match: null, target: 'atlas' });
    addRoute('dc:3', { seq: 0, type: 'default', match: null, target: 'atlas' });
    addRoute('tg:8', { seq: 0, type: 'default', match: null, target: 'other' });
    const jids = getJidsForFolder('atlas');
    expect(jids).toContain('tg:7');
    expect(jids).toContain('dc:3');
    expect(jids).not.toContain('tg:8');
  });

  it('getRoutesForJid returns empty for unknown JID', () => {
    expect(getRoutesForJid('unknown:999')).toEqual([]);
  });
});

// --- getHubForJid ---

describe('getHubForJid', () => {
  it('returns static folder target', () => {
    addRoute('tg:h1', { seq: 0, type: 'default', match: null, target: 'root' });
    expect(getHubForJid('tg:h1')).toBe('root');
  });

  it('returns base folder for template target', () => {
    addRoute('tg:h2', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'atlas/{sender}',
    });
    expect(getHubForJid('tg:h2')).toBe('atlas');
  });

  it('returns null when no default route exists', () => {
    addRoute('tg:h3', {
      seq: 0,
      type: 'command',
      match: '/x',
      target: 'code',
    });
    expect(getHubForJid('tg:h3')).toBeNull();
  });

  it('returns null for unknown JID', () => {
    expect(getHubForJid('unknown:0')).toBeNull();
  });
});

// --- getRouteTargetsForJid ---

describe('getRouteTargetsForJid', () => {
  it('returns distinct targets, resolving template bases', () => {
    addRoute('tg:t1', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'atlas/{sender}',
    });
    addRoute('tg:t1', {
      seq: 1,
      type: 'command',
      match: '/code',
      target: 'code',
    });
    const targets = getRouteTargetsForJid('tg:t1');
    expect(targets).toContain('atlas');
    expect(targets).toContain('code');
  });

  it('returns empty for unknown JID', () => {
    expect(getRouteTargetsForJid('unknown:0')).toEqual([]);
  });
});

// --- hasAlwaysOnRoute ---

describe('hasAlwaysOnRoute', () => {
  it('returns false when no routes exist', () => {
    expect(hasAlwaysOnRoute()).toBe(false);
  });

  it('returns true when a default route exists', () => {
    addRoute('tg:ao', { seq: 0, type: 'default', match: null, target: 'root' });
    expect(hasAlwaysOnRoute()).toBe(true);
  });

  it('returns false when only command routes exist', () => {
    addRoute('tg:cmd', {
      seq: 0,
      type: 'command',
      match: '/x',
      target: 'root',
    });
    expect(hasAlwaysOnRoute()).toBe(false);
  });
});

// --- getDirectChildGroupCount ---

describe('getDirectChildGroupCount', () => {
  it('counts direct children only', () => {
    setGroupConfig({
      name: 'a',
      folder: 'atlas',
      added_at: '2024-01-01T00:00:00Z',
    });
    setGroupConfig({
      name: 'b',
      folder: 'atlas/child1',
      added_at: '2024-01-01T00:00:00Z',
    });
    setGroupConfig({
      name: 'c',
      folder: 'atlas/child2',
      added_at: '2024-01-01T00:00:00Z',
    });
    setGroupConfig({
      name: 'd',
      folder: 'atlas/child1/grandchild',
      added_at: '2024-01-01T00:00:00Z',
    });
    expect(getDirectChildGroupCount('atlas')).toBe(2);
  });

  it('returns 0 when no children exist', () => {
    setGroupConfig({
      name: 'a',
      folder: 'lone',
      added_at: '2024-01-01T00:00:00Z',
    });
    expect(getDirectChildGroupCount('lone')).toBe(0);
  });
});

// --- deleteGroupConfig ---

describe('deleteGroupConfig', () => {
  it('removes group from DB', () => {
    setGroupConfig({
      name: 'del',
      folder: 'delme',
      added_at: '2024-01-01T00:00:00Z',
    });
    expect(getGroupByFolder('delme')).toBeDefined();
    deleteGroupConfig('delme');
    expect(getGroupByFolder('delme')).toBeUndefined();
  });
});

// --- getGroupBySlink ---

describe('getGroupBySlink', () => {
  it('returns undefined for unknown token', () => {
    expect(getGroupBySlink('bad-token')).toBeUndefined();
  });

  it('returns group with jid when route exists', () => {
    _setTestGroupRoute('tg:slink', {
      name: 'Slink Group',
      folder: 'slinked',
      slinkToken: 'tok123',
    });
    const g = getGroupBySlink('tok123');
    expect(g).toBeDefined();
    expect(g!.folder).toBe('slinked');
    expect(g!.jid).toBe('tg:slink');
  });

  it('falls back to web: JID when no route exists', () => {
    setGroupConfig({
      name: 'Web Group',
      folder: 'webgrp',
      added_at: '2024-01-01T00:00:00Z',
      slinkToken: 'webtok',
    });
    const g = getGroupBySlink('webtok');
    expect(g).toBeDefined();
    expect(g!.jid).toBe('web:webgrp');
  });
});

// --- storeChatMetadata edge cases ---

describe('storeChatMetadata edge cases', () => {
  it('stores channel and is_group flags', () => {
    storeChatMetadata(
      'dc:123',
      '2024-01-01T00:00:00.000Z',
      'DC Chat',
      'discord',
      true,
    );
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].channel).toBe('discord');
    expect(chats[0].is_group).toBe(1);
  });

  it('does not overwrite name when called without name', () => {
    storeChatMetadata('keep@g.us', '2024-01-01T00:00:00.000Z', 'Original Name');
    storeChatMetadata('keep@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].name).toBe('Original Name');
  });

  it('coalesces channel on conflict', () => {
    storeChatMetadata(
      'ch@g.us',
      '2024-01-01T00:00:00.000Z',
      undefined,
      'telegram',
    );
    storeChatMetadata('ch@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].channel).toBe('telegram');
  });
});

// --- storeMessage with optional fields ---

describe('storeMessage with forwarding/reply fields', () => {
  it('stores and retrieves forwarded_from fields', () => {
    storeChatMetadata('g@g.us', '2024-01-01T00:00:00.000Z');
    storeMessage({
      id: 'fwd-1',
      chat_jid: 'g@g.us',
      sender: 'u@s',
      content: 'forwarded',
      timestamp: '2024-01-01T00:00:01.000Z',
      forwarded_from: 'Alice',
      forwarded_from_id: 'chat:123',
      forwarded_msgid: 'orig-msg-1',
    });
    const m = getMessageById('fwd-1');
    expect(m).toBeDefined();
    expect(m!.forwarded_from).toBe('Alice');
    expect(m!.forwarded_from_id).toBe('chat:123');
    expect(m!.forwarded_msgid).toBe('orig-msg-1');
  });

  it('stores and retrieves reply_to fields', () => {
    storeChatMetadata('g@g.us', '2024-01-01T00:00:00.000Z');
    storeMessage({
      id: 'rpl-1',
      chat_jid: 'g@g.us',
      sender: 'u@s',
      content: 'reply',
      timestamp: '2024-01-01T00:00:01.000Z',
      reply_to_text: 'original text',
      reply_to_sender: 'Bob',
      reply_to_id: 'msg-orig',
    });
    const m = getMessageById('rpl-1');
    expect(m).toBeDefined();
    expect(m!.reply_to_text).toBe('original text');
    expect(m!.reply_to_sender).toBe('Bob');
    expect(m!.reply_to_id).toBe('msg-orig');
  });
});
