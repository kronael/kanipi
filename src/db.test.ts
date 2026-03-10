import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  _setRawGroupColumns,
  _setTestGroupRoute,
  createTask,
  deleteTask,
  enqueueSystemMessage,
  flushSystemMessages,
  getAllChats,
  getAllGroupConfigs,
  getDueTasks,
  getGroupByFolder,
  getMessagesSince,
  getNewMessages,
  getRecentSessions,
  getTaskById,
  pruneExpiredSessions,
  recordSessionStart,
  setGroupConfig,
  storeChatMetadata,
  storeMessage,
  updateSessionEnd,
  updateTask,
  updateTaskAfterRun,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized NewMessage interface
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

// --- storeMessage (NewMessage format) ---

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
      group_folder: 'main',
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
      group_folder: 'main',
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
      group_folder: 'main',
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

  it('deletes a task and its run logs', () => {
    createTask({
      id: 'task-3',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'delete me',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    deleteTask('task-3');
    expect(getTaskById('task-3')).toBeUndefined();
  });
});

// --- getDueTasks ---

describe('getDueTasks', () => {
  it('excludes tasks with null next_run', () => {
    createTask({
      id: 'task-paused',
      group_folder: 'main',
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
      group_folder: 'main',
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

// --- getNewMessages edge cases ---

describe('getNewMessages edge cases', () => {
  it('returns empty array for empty jids without error', () => {
    const result = getNewMessages([], '0', 'Bot');
    expect(result).toEqual({ messages: [], newTimestamp: '0' });
  });
});

// --- setGroupConfig ---

describe('setGroupConfig', () => {
  it('throws on invalid folder path', () => {
    expect(() =>
      setGroupConfig({
        name: 'escape',
        folder: '../escape',
        trigger: '',
        requiresTrigger: false,
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
        trigger: '',
        requiresTrigger: false,
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
      trigger: '/go',
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

  it('flush is atomic: returns XML and deletes in same transaction', () => {
    enqueueSystemMessage('grp-a', { origin: 'gw', body: 'msg' });
    const xml = flushSystemMessages('grp-a');
    expect(xml).not.toBe('');
    expect(flushSystemMessages('grp-a')).toBe('');
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

// --- DB-boundary: malformed groups JSON ---

describe('groups DB-boundary: malformed JSON', () => {
  it('invalid JSON in container_config: getGroupByFolder returns undefined for field', () => {
    _setRawGroupColumns('bad-cc-json', {
      container_config: 'not-json',
    });
    const g = getGroupByFolder('bad-cc-json');
    expect(g).toBeDefined();
    expect(g!.containerConfig).toBeUndefined();
  });

  it('schema-invalid JSON in container_config: getGroupByFolder returns undefined for field', () => {
    _setRawGroupColumns('bad-cc-schema', {
      container_config: JSON.stringify({ timeout: 'not-a-number' }),
    });
    const g = getGroupByFolder('bad-cc-schema');
    expect(g).toBeDefined();
    expect(g!.containerConfig).toBeUndefined();
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
