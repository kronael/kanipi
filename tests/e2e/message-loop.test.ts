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
import fs from 'fs';

// ── Mock config ───────────────────────────────────────────────────────────────

vi.mock('../../src/config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  CONTAINER_IMAGE: 'nanoclaw-agent:latest',
  CONTAINER_MAX_OUTPUT_SIZE: 10485760,
  CONTAINER_TIMEOUT: 1800000,
  DATA_DIR: '/tmp/kanipi-e2e-data',
  GROUPS_DIR: '/tmp/kanipi-e2e-groups',
  HOST_PROJECT_ROOT_PATH: '/tmp/kanipi-e2e-root',
  isRoot: (f: string) => f === 'root',
  permissionTier: (f: string) =>
    f === 'root' ? 0 : Math.min(f.split('/').length, 3),
  MAX_CONCURRENT_CONTAINERS: 2,
  MEDIA_ENABLED: false,
  POLL_INTERVAL: 50,
  SCHEDULER_POLL_INTERVAL: 60000,
  STORE_DIR: '/tmp/kanipi-e2e-store',
  TIMEZONE: 'UTC',
  IPC_POLL_INTERVAL: 1000,
  WEB_DIR: '/tmp/kanipi-e2e-web',
  SEND_DISABLED_CHANNELS: new Set<string>(),
  SEND_DISABLED_GROUPS: new Set<string>(),
}));

vi.mock('../../src/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// ── Mock fs (suppress file-system side effects) ───────────────────────────────
// Allow real fs for migrations directory (needed by migration runner)

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: (path: string, ...args: unknown[]) => {
        if (typeof path === 'string' && path.includes('migrations')) {
          return actual.readFileSync(path, ...args);
        }
        return '{}';
      },
      existsSync: vi.fn(() => false),
      appendFileSync: vi.fn(),
      renameSync: vi.fn(),
      readdirSync: (path: string, ...args: unknown[]) => {
        if (typeof path === 'string' && path.includes('migrations')) {
          return actual.readdirSync(path, ...args);
        }
        return [];
      },
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
  runContainerCommand: mockRunContainerAgent,
  writeActionManifest: vi.fn(),
  writeGroupsSnapshot: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  _initTestDatabase,
  _setTestGroupRoute,
  getHubForJid,
  getGroupByFolder,
  getMessagesSince,
  getNewMessages,
  getRoutedJids,
  getUnroutedChatJids,
  setRoutesForJid,
  storeMessage,
  storeChatMetadata,
} from '../../src/db.js';
import {
  getAvailableGroups,
  _setGroups,
  _processGroupMessages,
  _pushChannel,
  _setLastMessageDate,
  _getLastAgentTimestamp,
  _clearTestState,
  _delegateToChild,
  _isStickyCommand,
} from '../../src/index.js';
import { getStickyGroup, setStickyGroup } from '../../src/db.js';
import type { GroupConfig } from '../../src/db.js';
import type { Channel } from '../../src/types.js';
import type { ContainerInput } from '../../src/container-runner.js';

beforeEach(() => {
  vi.useFakeTimers();
  _initTestDatabase();
  _setGroups({});
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
    _setGroups({
      g1: {
        name: 'G1',
        folder: 'g1',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });
    setRoutesForJid('g1@g.us', [
      { seq: 0, type: 'default', match: null, target: 'g1' },
    ]);
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

// ── DB state consistency ──────────────────────────────────────────────────────

describe('DB state for gateway routing', () => {
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

  it('_setTestGroupRoute persists and is queryable', () => {
    _setTestGroupRoute('g@g.us', {
      name: 'Test',
      folder: 'test',
    });
    expect(getHubForJid('g@g.us')).toBe('test');
    const group = getGroupByFolder('test');
    expect(group).toBeDefined();
    expect(group!.name).toBe('Test');
    expect(group!.folder).toBe('test');
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
const TEST_GROUP: GroupConfig = {
  name: 'Test Group',
  folder: TEST_FOLDER,
  added_at: '2024-01-01T00:00:00.000Z',
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
  _setGroups({ [TEST_FOLDER]: TEST_GROUP });
  setRoutesForJid(TEST_JID, [
    { seq: 0, type: 'default', match: null, target: TEST_FOLDER },
  ]);
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
  it('sends error message and advances cursor on error with no output', async () => {
    const ch = setupGroup();
    mockRunContainerAgent.mockResolvedValue({
      status: 'error',
      result: null,
      error: 'crashed',
    });

    const result = await _processGroupMessages(TEST_JID);

    const retryCall = (
      ch.sendMessage as ReturnType<typeof vi.fn>
    ).mock.calls.find(([, text]: [string, string]) =>
      text.includes('Something went wrong'),
    );
    expect(retryCall).toBeDefined();
    // Cursor advances — no auto-retry (user told to retry manually)
    expect(result).toBe(true);
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

// ── Routing delegate dispatch ─────────────────────────────────────────────────

const ROUTED_JID = 'parent@g.us';
const CHILD_FOLDER = 'root/code';
const CHILD_JID = 'child@g.us';
const ROUTED_MSG_TS = '2024-02-01T00:01:00.000Z';

function setupRoutedGroup(registerChild: boolean): Channel & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  storeChatMetadata(
    ROUTED_JID,
    '2024-02-01T00:00:00.000Z',
    'Parent',
    'test',
    true,
  );
  storeMessage({
    id: 'route-msg-1',
    chat_jid: ROUTED_JID,
    sender: 'user@s.us',
    sender_name: 'Alice',
    content: '/code fix the bug',
    timestamp: ROUTED_MSG_TS,
  });

  const groupConfigs: Record<string, GroupConfig> = {
    root: {
      name: 'Main',
      folder: 'root',
      added_at: '2024-02-01T00:00:00.000Z',
    },
  };

  const jidMap: Record<string, string> = {
    [ROUTED_JID]: 'root',
  };

  if (registerChild) {
    groupConfigs[CHILD_FOLDER] = {
      name: 'Code',
      folder: CHILD_FOLDER,
      added_at: '2024-02-01T00:00:00.000Z',
    };
    jidMap[CHILD_JID] = CHILD_FOLDER;
  }

  _setGroups(groupConfigs);

  // Set up flat routing via routes table: default route to root + command override
  setRoutesForJid(ROUTED_JID, [
    { seq: 0, type: 'command', match: '/code', target: CHILD_FOLDER },
    { seq: 1, type: 'default', match: null, target: 'root' },
  ]);

  const ch = makeChannel(ROUTED_JID);
  _pushChannel(ch);
  return ch;
}

describe('processGroupMessages — routing delegate', () => {
  it('advances cursor and returns true when routing rule matches', async () => {
    setupRoutedGroup(true);

    const result = await _processGroupMessages(ROUTED_JID);

    expect(result).toBe(true);
    expect(_getLastAgentTimestamp(ROUTED_JID)).toBe(ROUTED_MSG_TS);
  });

  it('calls runContainerCommand for child group (not parent)', async () => {
    setupRoutedGroup(true);
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
      newSessionId: 'sess-child-1',
    });

    await _processGroupMessages(ROUTED_JID);

    // runContainerCommand is called synchronously inside delegateToChild's task
    // (enqueueTask → runTask → task.fn() runs sync up to first await)
    expect(mockRunContainerAgent).toHaveBeenCalled();
    const [calledGroup, calledInput] = mockRunContainerAgent.mock.calls[0] as [
      GroupConfig,
      ContainerInput,
      ...unknown[],
    ];
    expect(calledGroup.folder).toBe(CHILD_FOLDER);
    // Routing dispatch always initiates at depth 0 — agent receives delegateDepth: 0
    expect(calledInput.delegateDepth).toBe(0);
  });

  it('does NOT call runContainerCommand for parent group when routing matches', async () => {
    setupRoutedGroup(true);
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
    });

    await _processGroupMessages(ROUTED_JID);

    for (const call of mockRunContainerAgent.mock.calls) {
      const [g] = call as [GroupConfig, ...unknown[]];
      expect(g.folder).not.toBe('root');
    }
  });
});

// ── Delegation depth monotonicity ─────────────────────────────────────────────

describe('delegateToChild — depth propagation', () => {
  it('passes delegateDepth to runContainerCommand unchanged', async () => {
    setupRoutedGroup(true);
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
    });
    const ch = makeChannel(ROUTED_JID);
    _pushChannel(ch);

    // Simulate IPC delegate_group that already incremented depth to 1
    await _delegateToChild(CHILD_FOLDER, 'do it', ROUTED_JID, 1);

    expect(mockRunContainerAgent).toHaveBeenCalled();
    const [, input] = mockRunContainerAgent.mock.calls[0] as [
      GroupConfig,
      ContainerInput,
      ...unknown[],
    ];
    expect(input.delegateDepth).toBe(1);
  });
});

// ── Routed-failure rollback ────────────────────────────────────────────────────

describe('processGroupMessages — clone-on-missing child', () => {
  it('spawns child from prototype when child is not registered', async () => {
    setupRoutedGroup(false /* no child group registered */);
    vi.mocked(fs.existsSync).mockImplementation((p) =>
      String(p).endsWith('/prototype'),
    );

    await _processGroupMessages(ROUTED_JID);
    await Promise.resolve();

    // Clone-on-missing spawns the child — cursor advances, agent runs
    expect(_getLastAgentTimestamp(ROUTED_JID)).toBe(ROUTED_MSG_TS);
    expect(mockRunContainerAgent).toHaveBeenCalled();
    const [group] = mockRunContainerAgent.mock.calls[0];
    expect(group.folder).toBe(CHILD_FOLDER);
  });
});

// ── Flat routing behavior ─────────────────────────────────────────────────────
//
// With flat routing, routes are ALWAYS followed at runtime. Authorization is
// enforced only when routes are CREATED via IPC actions (set_routes, add_route).
// If delegation fails (e.g., target can't be spawned because parent doesn't
// exist), the cursor rolls back and no agent runs.
//
// These tests verify the delegation-failure behavior: when a route exists but
// the target cannot be spawned (no registered parent), delegation fails and
// the cursor is rolled back.

const UNAUTH_TS = '2024-04-01T00:01:00.000Z';

function setupUnauthorizedRouting(
  sourceJid: string,
  sourceFolder: string,
  unauthorizedTarget: string,
): void {
  storeChatMetadata(
    sourceJid,
    '2024-04-01T00:00:00.000Z',
    'Source',
    'test',
    true,
  );
  storeMessage({
    id: `unauth-${sourceFolder.replace(/\//g, '-')}-msg`,
    chat_jid: sourceJid,
    sender: 'user@s.us',
    content: '/route me somewhere',
    timestamp: UNAUTH_TS,
  });
  _setGroups({
    [sourceFolder]: {
      name: 'Source',
      folder: sourceFolder,
      added_at: '2024-04-01T00:00:00.000Z',
    },
  });

  // Set up flat routing via routes table: default route to source + command override
  setRoutesForJid(sourceJid, [
    { seq: 0, type: 'command', match: '/route', target: unauthorizedTarget },
    { seq: 1, type: 'default', match: null, target: sourceFolder },
  ]);
  _pushChannel(makeChannel(sourceJid));
  mockRunContainerAgent.mockResolvedValue({
    status: 'success',
    result: null,
    newSessionId: 'parent-sess',
  });
}

// Path 1: processGroupMessages called directly (pull path via queue).
describe('flat routing — delegation failure rollback', () => {
  it('grandchild target (root → root/code/py): delegates but fails, cursor advances (dropped)', async () => {
    setupUnauthorizedRouting('src@g.us', 'root', 'root/code/py');

    const ok = await _processGroupMessages('src@g.us');

    expect(ok).toBe(true);
    // Grandchild delegation attempted, but parent (root/code) not registered
    expect(mockRunContainerAgent).not.toHaveBeenCalled();
    await Promise.resolve();
    // Cursor advances - message dropped, not retried
    expect(_getLastAgentTimestamp('src@g.us')).toBe(UNAUTH_TS);
  });

  it('cross-world target (root → other/code): delegates but fails, cursor advances (dropped)', async () => {
    // With flat routing, routes are always followed (no runtime auth check).
    // Authorization is enforced when routes are CREATED via IPC.
    // Here: delegation fails because parent "other" doesn't exist.
    // Cursor advances (message marked as processed but failed delivery).
    setupUnauthorizedRouting('src@g.us', 'root', 'other/code');

    const ok = await _processGroupMessages('src@g.us');

    expect(ok).toBe(true);
    // Delegation attempted, no spawn possible, no agent runs
    expect(mockRunContainerAgent).not.toHaveBeenCalled();
    await Promise.resolve();
    // Cursor advances - message dropped, not retried
    expect(_getLastAgentTimestamp('src@g.us')).toBe(UNAUTH_TS);
  });
});

// ── Onboarding — unrouted JID fetch path ─────────────────────────────────────
//
// Regression: getNewMessages(getRoutedJids(), ...) silently excluded unrouted
// JIDs — new users never got their messages fetched, so handleOnboarding was
// never called. Fix: append getUnroutedChatJids(since) to the jids list.
//
// These tests verify the full fetch path for unrouted JIDs using real DB calls.

describe('onboarding — unrouted JID message fetching', () => {
  const SINCE = '2024-06-01T00:00:00.000Z';
  const NEW_USER_JID = 'newuser@s.whatsapp.net';
  const MSG_TS = '2024-06-01T00:01:00.000Z';

  beforeEach(() => {
    storeChatMetadata(NEW_USER_JID, SINCE, 'New User', 'whatsapp', false);
    storeMessage({
      id: 'new-u-msg-1',
      chat_jid: NEW_USER_JID,
      sender: NEW_USER_JID,
      sender_name: 'New User',
      content: 'hello',
      timestamp: MSG_TS,
    });
  });

  it('getRoutedJids does NOT include unrouted JID', () => {
    const jids = getRoutedJids();
    expect(jids).not.toContain(NEW_USER_JID);
  });

  it('getUnroutedChatJids returns unrouted JID with recent message', () => {
    const jids = getUnroutedChatJids(SINCE);
    expect(jids).toContain(NEW_USER_JID);
  });

  it('getNewMessages with unrouted JID included fetches the message', () => {
    const jids = [...getRoutedJids(), ...getUnroutedChatJids(SINCE)];
    const { messages } = getNewMessages(jids, SINCE, 'Andy');
    const found = messages.find((m) => m.chat_jid === NEW_USER_JID);
    expect(found).toBeDefined();
    expect(found!.content).toBe('hello');
  });

  it('getNewMessages WITHOUT unrouted JID does NOT fetch the message', () => {
    // Regression: before the fix, only getRoutedJids() was passed → new user messages lost
    const jids = getRoutedJids();
    const { messages } = getNewMessages(jids, SINCE, 'Andy');
    const found = messages.find((m) => m.chat_jid === NEW_USER_JID);
    expect(found).toBeUndefined();
  });

  it('excludes unrouted JID after a route is added for it', () => {
    setRoutesForJid(NEW_USER_JID, [
      { seq: 0, type: 'default', match: null, target: 'someworld' },
    ]);
    const jids = getUnroutedChatJids(SINCE);
    expect(jids).not.toContain(NEW_USER_JID);
  });
});

// ── isStickyCommand ───────────────────────────────────────────────────────────

describe('isStickyCommand', () => {
  it('matches bare @', () => expect(_isStickyCommand('@')).toBe(true));
  it('matches @name', () => expect(_isStickyCommand('@code')).toBe(true));
  it('matches @name/sub', () =>
    expect(_isStickyCommand('@code/py')).toBe(true));
  it('rejects @name with trailing space and text', () =>
    expect(_isStickyCommand('@name hello')).toBe(false));
  it('rejects plain text', () => expect(_isStickyCommand('hello')).toBe(false));
  it('rejects empty string', () => expect(_isStickyCommand('')).toBe(false));
  it('rejects whitespace only', () =>
    expect(_isStickyCommand('  ')).toBe(false));
});

// ── sticky command handling ───────────────────────────────────────────────────

const HUB_JID = 'hub@g.us';
const HUB_FOLDER = 'hub';
const SUB_FOLDER = 'hub/code';

function setupHub(): Channel & { sendMessage: ReturnType<typeof vi.fn> } {
  storeChatMetadata(HUB_JID, '2024-05-01T00:00:00.000Z', 'Hub', 'test', true);
  _setGroups({
    [HUB_FOLDER]: {
      name: 'Hub',
      folder: HUB_FOLDER,
      added_at: '2024-05-01T00:00:00.000Z',
    },
    [SUB_FOLDER]: {
      name: 'Code',
      folder: SUB_FOLDER,
      added_at: '2024-05-01T00:00:00.000Z',
    },
  });
  setRoutesForJid(HUB_JID, [
    { seq: 0, type: 'default', match: null, target: HUB_FOLDER },
  ]);
  const ch = makeChannel(HUB_JID);
  _pushChannel(ch);
  return ch;
}

function stickyMsg(id: string, content: string, ts: string): void {
  storeMessage({
    id,
    chat_jid: HUB_JID,
    sender: 'user@s.us',
    sender_name: 'Alice',
    content,
    timestamp: ts,
  });
}

describe('processGroupMessages — sticky command', () => {
  it('@name where child exists: sets sticky, sends confirm, returns true', async () => {
    const ch = setupHub();
    stickyMsg('s1', '@code', '2024-05-01T00:01:00.000Z');

    const result = await _processGroupMessages(HUB_JID);

    expect(result).toBe(true);
    expect(getStickyGroup(HUB_JID)).toBe(SUB_FOLDER);
    expect(_getLastAgentTimestamp(HUB_JID)).toBe('2024-05-01T00:01:00.000Z');
    const calls = (ch.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, text]: [string, string]) => text.includes(SUB_FOLDER)),
    ).toBe(true);
    expect(mockRunContainerAgent).not.toHaveBeenCalled();
  });

  it('@name where child does NOT exist: sends Unknown group, returns true, no sticky set', async () => {
    const ch = setupHub();
    stickyMsg('s2', '@missing', '2024-05-01T00:02:00.000Z');

    const result = await _processGroupMessages(HUB_JID);

    expect(result).toBe(true);
    expect(getStickyGroup(HUB_JID)).toBeNull();
    expect(_getLastAgentTimestamp(HUB_JID)).toBe('2024-05-01T00:02:00.000Z');
    const calls = (ch.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, text]: [string, string]) =>
        text.includes('Unknown group'),
      ),
    ).toBe(true);
    expect(mockRunContainerAgent).not.toHaveBeenCalled();
  });

  it('@ alone: clears sticky, sends routing reset, returns true', async () => {
    const ch = setupHub();
    // Pre-set sticky then clear it
    stickyMsg('s3a', '@code', '2024-05-01T00:03:00.000Z');
    await _processGroupMessages(HUB_JID);
    vi.resetAllMocks();

    stickyMsg('s3b', '@', '2024-05-01T00:04:00.000Z');
    const result = await _processGroupMessages(HUB_JID);

    expect(result).toBe(true);
    expect(getStickyGroup(HUB_JID)).toBeNull();
    expect(_getLastAgentTimestamp(HUB_JID)).toBe('2024-05-01T00:04:00.000Z');
    const calls = (ch.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      calls.some(([, text]: [string, string]) =>
        text.includes('routing reset'),
      ),
    ).toBe(true);
    expect(mockRunContainerAgent).not.toHaveBeenCalled();
  });
});

// ── sticky routing ────────────────────────────────────────────────────────────

describe('processGroupMessages — sticky routing', () => {
  it('routes via sticky when no resolved route', async () => {
    // Use local: JID — group resolved by folder name, no routes needed.
    // With no routes for this JID, resolveRoute returns null and sticky fires.
    const LOCAL_JID = `local:${HUB_FOLDER}`;
    storeChatMetadata(
      LOCAL_JID,
      '2024-05-01T00:00:00.000Z',
      'Hub',
      'test',
      true,
    );
    _setGroups({
      [HUB_FOLDER]: {
        name: 'Hub',
        folder: HUB_FOLDER,
        added_at: '2024-05-01T00:00:00.000Z',
      },
      [SUB_FOLDER]: {
        name: 'Code',
        folder: SUB_FOLDER,
        added_at: '2024-05-01T00:00:00.000Z',
      },
    });
    const ch = makeChannel(LOCAL_JID);
    _pushChannel(ch);

    // Set sticky via @code command
    storeMessage({
      id: 'sr1-cmd',
      chat_jid: LOCAL_JID,
      sender: 'user@s.us',
      sender_name: 'Alice',
      content: '@code',
      timestamp: '2024-05-01T00:05:00.000Z',
    });
    await _processGroupMessages(LOCAL_JID);

    // Send a plain message — no routes, sticky should fire
    storeMessage({
      id: 'sr1-msg',
      chat_jid: LOCAL_JID,
      sender: 'user@s.us',
      sender_name: 'Alice',
      content: 'hello',
      timestamp: '2024-05-01T00:06:00.000Z',
    });
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
    });

    const result = await _processGroupMessages(LOCAL_JID);

    expect(result).toBe(true);
    expect(_getLastAgentTimestamp(LOCAL_JID)).toBe('2024-05-01T00:06:00.000Z');
    expect(mockRunContainerAgent).toHaveBeenCalled();
    const [calledGroup] = mockRunContainerAgent.mock.calls[0] as [
      GroupConfig,
      ...unknown[],
    ];
    expect(calledGroup.folder).toBe(SUB_FOLDER);
  });

  it('resolved route takes precedence over sticky', async () => {
    // Hub has two children: code and research. Sticky = code, but /research command routes to research.
    const RESEARCH_FOLDER = 'hub/research';
    storeChatMetadata(HUB_JID, '2024-05-01T00:00:00.000Z', 'Hub', 'test', true);
    _setGroups({
      [HUB_FOLDER]: {
        name: 'Hub',
        folder: HUB_FOLDER,
        added_at: '2024-05-01T00:00:00.000Z',
      },
      [SUB_FOLDER]: {
        name: 'Code',
        folder: SUB_FOLDER,
        added_at: '2024-05-01T00:00:00.000Z',
      },
      [RESEARCH_FOLDER]: {
        name: 'Research',
        folder: RESEARCH_FOLDER,
        added_at: '2024-05-01T00:00:00.000Z',
      },
    });
    setRoutesForJid(HUB_JID, [
      { seq: 0, type: 'command', match: '/research', target: RESEARCH_FOLDER },
      { seq: 1, type: 'default', match: null, target: HUB_FOLDER },
    ]);
    _pushChannel(makeChannel(HUB_JID));

    // Set sticky to code
    stickyMsg('sr2-cmd', '@code', '2024-05-01T00:07:00.000Z');
    await _processGroupMessages(HUB_JID);

    // Send /research — resolved route should win over sticky
    stickyMsg('sr2-msg', '/research findings', '2024-05-01T00:08:00.000Z');
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
    });

    await _processGroupMessages(HUB_JID);

    expect(mockRunContainerAgent).toHaveBeenCalled();
    const [calledGroup] = mockRunContainerAgent.mock.calls[0] as [
      GroupConfig,
      ...unknown[],
    ];
    expect(calledGroup.folder).toBe(RESEARCH_FOLDER);
  });

  it('no delegation when sticky equals group folder (hub set as its own sticky)', async () => {
    setupHub();
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: null,
      newSessionId: 'sess-hub',
    });

    // Manually set sticky to the hub itself (edge case — @hub from within hub)
    setStickyGroup(HUB_JID, HUB_FOLDER);

    stickyMsg('sr3-msg', 'hello', '2024-05-01T00:09:00.000Z');
    await _processGroupMessages(HUB_JID);

    // Agent runs for hub itself, not delegated
    expect(mockRunContainerAgent).toHaveBeenCalled();
    const [calledGroup] = mockRunContainerAgent.mock.calls[0] as [
      GroupConfig,
      ...unknown[],
    ];
    expect(calledGroup.folder).toBe(HUB_FOLDER);
  });
});
