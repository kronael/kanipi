/**
 * Gateway message loop integration tests.
 *
 * Tests the wiring of: GroupQueue + DB + container-runner (mocked) + routing.
 * Does not require docker — the container runner is replaced with a fake that
 * returns a canned response. The goal is to test the gateway orchestration
 * logic (message flow, queueing, session tracking, trigger gating) end-to-end
 * without channel or docker dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// ── Mock config ───────────────────────────────────────────────────────────────

vi.mock('../../src/config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  DATA_DIR: '/tmp/kanipi-e2e-data',
  GROUPS_DIR: '/tmp/kanipi-e2e-groups',
  HOST_PROJECT_ROOT_PATH: '/tmp/kanipi-e2e-root',
  IDLE_TIMEOUT: 1800000,
  MAIN_GROUP_FOLDER: 'main',
  MAX_CONCURRENT_CONTAINERS: 2,
  MEDIA_ENABLED: false,
  POLL_INTERVAL: 50,
  SCHEDULER_POLL_INTERVAL: 60000,
  TIMEZONE: 'UTC',
  TRIGGER_PATTERN: /^@Andy\b/i,
  IPC_POLL_INTERVAL: 1000,
  WEB_DIR: '/tmp/kanipi-e2e-web',
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Mock fs (suppress file-system side effects) ───────────────────────────────

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(() => '{}'),
      existsSync: vi.fn(() => false),
      renameSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      watch: vi.fn(() => ({ close: vi.fn() })),
    },
  };
});

// ── Mock channels ─────────────────────────────────────────────────────────────

vi.mock('../../src/channels/telegram.js', () => ({
  TelegramChannel: vi.fn().mockImplementation(() => ({
    name: 'telegram',
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => false),
    disconnect: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ownsJid: vi.fn(() => false),
  })),
}));

vi.mock('../../src/channels/whatsapp.js', () => ({
  WhatsAppChannel: vi.fn(),
}));

vi.mock('../../src/channels/discord.js', () => ({
  DiscordChannel: vi.fn().mockImplementation(() => ({
    name: 'discord',
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => false),
    disconnect: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ownsJid: vi.fn(() => false),
  })),
}));

vi.mock('../../src/channels/web.js', () => ({
  WebChannel: vi.fn(),
}));

vi.mock('../../src/web-proxy.js', () => ({
  startWebProxy: vi.fn(),
}));

vi.mock('../../src/container-runtime.js', () => ({
  ensureContainerRuntimeRunning: vi.fn().mockResolvedValue(undefined),
  cleanupOrphans: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ipc.js', () => ({
  startIpcWatcher: vi.fn(),
}));

vi.mock('../../src/task-scheduler.js', () => ({
  startSchedulerLoop: vi.fn(),
}));

// ── Container runner fake ─────────────────────────────────────────────────────

const { mockRunContainerAgent } = vi.hoisted(() => ({
  mockRunContainerAgent: vi.fn(),
}));

vi.mock('../../src/container-runner.js', () => ({
  runContainerAgent: mockRunContainerAgent,
  writeGroupsSnapshot: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  _initTestDatabase,
  getAllRegisteredGroups,
  getMessagesSince,
  setRegisteredGroup,
  storeMessage,
  storeChatMetadata,
} from '../../src/db.js';
import { GroupQueue } from '../../src/group-queue.js';
import {
  getAvailableGroups,
  _setRegisteredGroups,
  _processGroupMessages,
  _pushChannel,
  _setLastMessageDate,
  _getLastAgentTimestamp,
  _clearTestState,
} from '../../src/index.js';
import type { RegisteredGroup } from '../../src/types.js';
import type { Channel } from '../../src/types.js';

beforeEach(() => {
  vi.useFakeTimers();
  _initTestDatabase();
  _setRegisteredGroups({});
  _clearTestState();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── getAvailableGroups ────────────────────────────────────────────────────────

describe('getAvailableGroups (gateway export)', () => {
  it('returns empty when no chats', () => {
    expect(getAvailableGroups()).toHaveLength(0);
  });

  it('returns registered groups with isRegistered=true', () => {
    storeChatMetadata(
      'g1@g.us',
      '2024-01-01T00:00:01.000Z',
      'G1',
      'telegram',
      true,
    );
    _setRegisteredGroups({
      'g1@g.us': {
        name: 'G1',
        folder: 'g1',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].isRegistered).toBe(true);
    expect(groups[0].jid).toBe('g1@g.us');
  });

  it('excludes non-group chats', () => {
    storeChatMetadata(
      'dm@s.whatsapp.net',
      '2024-01-01T00:00:01.000Z',
      'DM',
      'whatsapp',
      false,
    );
    expect(getAvailableGroups()).toHaveLength(0);
  });

  it('orders by most recent activity', () => {
    storeChatMetadata(
      'old@g.us',
      '2024-01-01T00:00:01.000Z',
      'Old',
      'telegram',
      true,
    );
    storeChatMetadata(
      'new@g.us',
      '2024-01-01T00:00:05.000Z',
      'New',
      'telegram',
      true,
    );
    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('new@g.us');
    expect(groups[1].jid).toBe('old@g.us');
  });
});

// ── GroupQueue + message dispatch integration ─────────────────────────────────

describe('GroupQueue message dispatch', () => {
  it('calls process function once when messages are enqueued for a group', async () => {
    const processMessages = vi.fn(async () => true);
    const queue = new GroupQueue();
    queue.setProcessMessagesFn(processMessages);

    queue.enqueueMessageCheck('group@g.us');
    await vi.advanceTimersByTimeAsync(10);

    expect(processMessages).toHaveBeenCalledWith('group@g.us');
  });

  it('serializes calls for the same group', async () => {
    let active = 0;
    let maxActive = 0;
    const processMessages = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 50));
      active--;
      return true;
    });
    const queue = new GroupQueue();
    queue.setProcessMessagesFn(processMessages);

    queue.enqueueMessageCheck('g@g.us');
    queue.enqueueMessageCheck('g@g.us');
    queue.enqueueMessageCheck('g@g.us');
    await vi.advanceTimersByTimeAsync(500);

    expect(maxActive).toBe(1);
  });

  it('tasks take priority over message checks', async () => {
    const order: string[] = [];
    const processMessages = vi.fn(async () => {
      order.push('message');
      await new Promise((r) => setTimeout(r, 10));
      return true;
    });
    const queue = new GroupQueue();
    queue.setProcessMessagesFn(processMessages);

    // Let first message check start running
    queue.enqueueMessageCheck('g@g.us');
    await vi.advanceTimersByTimeAsync(5);

    // Enqueue another message check + a task while the first is running
    queue.enqueueMessageCheck('g@g.us');
    queue.enqueueTask('g@g.us', 'task-1', async () => {
      order.push('task');
    });

    await vi.advanceTimersByTimeAsync(200);

    // task should run before second message check
    const taskIdx = order.indexOf('task');
    const secondMsgIdx = order.indexOf('message', 1);
    expect(taskIdx).toBeLessThan(secondMsgIdx);
  });
});

// ── DB state consistency ──────────────────────────────────────────────────────

describe('DB state for gateway routing', () => {
  it('storeChatMetadata creates group entry', () => {
    storeChatMetadata(
      'g@g.us',
      '2024-01-01T00:00:00.000Z',
      'Test',
      'telegram',
      true,
    );
    const groups = getAvailableGroups();
    expect(groups.find((g) => g.jid === 'g@g.us')).toBeDefined();
  });

  it('storeMessage content is retrievable for prompt building', () => {
    storeChatMetadata(
      'g@g.us',
      '2024-01-01T00:00:00.000Z',
      'G',
      'telegram',
      true,
    );
    storeMessage({
      id: 'm1',
      chat_jid: 'g@g.us',
      sender: 'u@s.whatsapp.net',
      sender_name: 'Alice',
      content: '@Andy help me',
      timestamp: '2024-01-01T00:01:00.000Z',
    });
    const msgs = getMessagesSince('g@g.us', '', 'Andy');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('@Andy help me');
  });

  it('setRegisteredGroup persists across getAllRegisteredGroups', () => {
    const group: RegisteredGroup = {
      name: 'Test',
      folder: 'test',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    setRegisteredGroup('g@g.us', group);
    const all = getAllRegisteredGroups();
    expect(all['g@g.us']).toBeDefined();
    expect(all['g@g.us'].name).toBe('Test');
  });
});

// ── processGroupMessages integration ─────────────────────────────────────────

function makeChannel(
  jid: string,
): Channel & { sendMessage: ReturnType<typeof vi.fn> } {
  return {
    name: 'test',
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(() => true),
    disconnect: vi.fn(),
    ownsJid: vi.fn((j: string) => j === jid),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

const TEST_JID = 'testgroup@g.us';
const TEST_FOLDER = 'testfolder';
const TEST_GROUP: RegisteredGroup = {
  name: 'Test Group',
  folder: TEST_FOLDER,
  trigger: '@Andy',
  added_at: '2024-01-01T00:00:00.000Z',
  requiresTrigger: false,
};

function setupGroup(): Channel & { sendMessage: ReturnType<typeof vi.fn> } {
  storeChatMetadata(TEST_JID, '2024-01-01T00:00:00.000Z', 'Test', 'test', true);
  storeMessage({
    id: 'msg1',
    chat_jid: TEST_JID,
    sender: 'user@s.us',
    sender_name: 'Alice',
    content: 'hello',
    timestamp: '2024-01-01T00:01:00.000Z',
  });
  _setRegisteredGroups({ [TEST_JID]: TEST_GROUP });
  const ch = makeChannel(TEST_JID);
  _pushChannel(ch);
  return ch;
}

describe('processGroupMessages — session/day injection', () => {
  it('enqueues new-session system message when no active session', async () => {
    setupGroup();
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
      newSessionId: 'sess-1',
    });

    await _processGroupMessages(TEST_JID);

    const [, input] = mockRunContainerAgent.mock.calls[0] as [
      unknown,
      { prompt: string },
    ];
    expect(input.prompt).toContain('event="new-session"');
  });

  it('enqueues new-day system message when date changed since last run', async () => {
    setupGroup();
    _setLastMessageDate(TEST_FOLDER, '2020-01-01');
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
      newSessionId: 'sess-2',
    });

    await _processGroupMessages(TEST_JID);

    const [, input] = mockRunContainerAgent.mock.calls[0] as [
      unknown,
      { prompt: string },
    ];
    expect(input.prompt).toContain('event="new-day"');
  });

  it('does NOT enqueue new-day when date is unchanged', async () => {
    setupGroup();
    const today = new Date().toISOString().slice(0, 10);
    _setLastMessageDate(TEST_FOLDER, today);
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
      newSessionId: 'sess-3',
    });

    await _processGroupMessages(TEST_JID);

    const [, input] = mockRunContainerAgent.mock.calls[0] as [
      unknown,
      { prompt: string },
    ];
    expect(input.prompt).not.toContain('event="new-day"');
  });
});

describe('processGroupMessages — agent error handling', () => {
  it('sends retry message and rolls back cursor on error with no output', async () => {
    const ch = setupGroup();
    mockRunContainerAgent.mockResolvedValue({
      status: 'error',
      result: null,
      error: 'crashed',
    });

    await _processGroupMessages(TEST_JID);

    const retryCall = (
      ch.sendMessage as ReturnType<typeof vi.fn>
    ).mock.calls.find(([, text]: [string, string]) =>
      text.includes('Something went wrong'),
    );
    expect(retryCall).toBeDefined();
    expect(_getLastAgentTimestamp(TEST_JID)).toBe('');
  });

  it('does NOT roll back cursor and skips retry when error after output sent', async () => {
    const ch = setupGroup();
    mockRunContainerAgent.mockImplementation(
      async (
        _g: unknown,
        _i: unknown,
        _p: unknown,
        onOutput?: (o: {
          status: string;
          result: string | null;
        }) => Promise<void>,
      ) => {
        if (onOutput) {
          await onOutput({ status: 'success', result: 'partial answer' });
        }
        return { status: 'error', result: null, error: 'crash after output' };
      },
    );

    await _processGroupMessages(TEST_JID);

    const retryCalls = (
      ch.sendMessage as ReturnType<typeof vi.fn>
    ).mock.calls.filter(([, text]: [string, string]) =>
      text.includes('Something went wrong'),
    );
    expect(retryCalls).toHaveLength(0);
    expect(_getLastAgentTimestamp(TEST_JID)).not.toBe('');
  });
});
