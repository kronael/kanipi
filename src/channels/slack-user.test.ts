import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// --- Hoisted mocks ---

const { mockLogger, createMockWs, getLastWs, resetLastWs } = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  let lastWs:
    | (EventEmitter & { readyState: number; close: ReturnType<typeof vi.fn> })
    | null = null;

  function createMockWs() {
    const ws = new EventEmitter() as EventEmitter & {
      readyState: number;
      close: ReturnType<typeof vi.fn>;
    };
    ws.readyState = 1; // OPEN
    ws.close = vi.fn(() => {
      ws.readyState = 3;
    });
    lastWs = ws;
    // Simulate open on next microtask
    Promise.resolve().then(() => ws.emit('open'));
    return ws;
  }

  return {
    mockLogger,
    createMockWs,
    getLastWs: () => lastWs,
    resetLastWs: () => {
      lastWs = null;
    },
  };
});

vi.mock('../logger.js', () => ({ logger: mockLogger }));
vi.mock('fs', () => ({
  default: {
    promises: { readFile: vi.fn().mockResolvedValue(Buffer.from('filedata')) },
  },
  promises: { readFile: vi.fn().mockResolvedValue(Buffer.from('filedata')) },
}));
vi.mock('ws', () => ({
  default: Object.assign(vi.fn().mockImplementation(createMockWs), { OPEN: 1 }),
}));

// --- fetch mock ---

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// --- helpers ---

function makeOpts() {
  return { onMessage: vi.fn(), onChatMetadata: vi.fn() };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    user: 'U123',
    channel: 'C456',
    ts: '1700000000.000100',
    text: 'hello world',
    channel_type: 'channel',
    ...overrides,
  };
}

async function triggerEvent(event: Record<string, unknown>) {
  getLastWs()!.emit('message', JSON.stringify(event));
  await new Promise((r) => setTimeout(r, 20));
}

function setupDefaultFetch() {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('auth.test'))
      return ok({ user_id: 'UBOTID', user: 'botuser' });
    if (url.includes('rtm.connect'))
      return ok({ url: 'wss://fake.slack.com/rtm' });
    if (url.includes('users.info'))
      return ok({ user: { real_name: 'Alice Smith', name: 'alice' } });
    if (url.includes('conversations.info'))
      return ok({ channel: { name: 'general' } });
    if (url.includes('chat.postMessage')) return ok({ ts: 'sent-ts-1' });
    if (url.includes('files.upload')) return ok({});
    return ok({});
  });
}

function ok(extra: Record<string, unknown> = {}) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ ok: true, ...extra }),
  });
}

import { SlackUserChannel } from './slack-user.js';
import { Verb, Platform } from '../types.js';

beforeEach(() => {
  vi.clearAllMocks();
  resetLastWs();
  setupDefaultFetch();
});

// --- constructor ---

describe('constructor', () => {
  it('starts disconnected with name slack-user', () => {
    const ch = new SlackUserChannel('xoxc', 'xoxd', makeOpts());
    expect(ch.isConnected()).toBe(false);
    expect(ch.name).toBe('slack-user');
  });
});

// --- connect() ---

describe('connect()', () => {
  it('calls auth.test then rtm.connect then opens WS', async () => {
    const ch = new SlackUserChannel('xoxc', 'xoxd', makeOpts());
    await ch.connect();
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('auth.test'))).toBe(true);
    expect(urls.some((u) => u.includes('rtm.connect'))).toBe(true);
    expect(getLastWs()).not.toBeNull();
    expect(ch.isConnected()).toBe(true);
  });

  it('logs connected with userId and username', async () => {
    const ch = new SlackUserChannel('xoxc', 'xoxd', makeOpts());
    await ch.connect();
    expect(mockLogger.info).toHaveBeenCalledWith(
      { userId: 'UBOTID', user: 'botuser' },
      'Slack user connected',
    );
  });

  it('propagates auth.test API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    });
    const ch = new SlackUserChannel('bad', 'bad', makeOpts());
    await expect(ch.connect()).rejects.toThrow('invalid_auth');
  });

  it('propagates rtm.connect API error', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, user_id: 'U1', user: 'u' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'not_allowed' }),
      });
    const ch = new SlackUserChannel('xoxc', 'xoxd', makeOpts());
    await expect(ch.connect()).rejects.toThrow('not_allowed');
  });
});

// --- message handler ---

describe('message handler', () => {
  let ch: SlackUserChannel;
  let opts: ReturnType<typeof makeOpts>;

  beforeEach(async () => {
    opts = makeOpts();
    ch = new SlackUserChannel('xoxc', 'xoxd', opts);
    await ch.connect();
    vi.clearAllMocks();
    setupDefaultFetch();
  });

  it('processes a normal message and calls both callbacks', async () => {
    await triggerEvent(makeEvent());
    expect(opts.onChatMetadata).toHaveBeenCalledOnce();
    expect(opts.onMessage).toHaveBeenCalledOnce();
  });

  it('skips non-message event types', async () => {
    await triggerEvent({ type: 'presence_change', user: 'U123' });
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips events with subtype', async () => {
    await triggerEvent(makeEvent({ subtype: 'message_changed' }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips missing user field', async () => {
    await triggerEvent(makeEvent({ user: undefined }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips own user messages', async () => {
    await triggerEvent(makeEvent({ user: 'UBOTID' }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('sets correct chatJid and sender', async () => {
    await triggerEvent(makeEvent());
    const [chatJid, event] = opts.onMessage.mock.calls[0];
    expect(chatJid).toBe('slack:C456');
    expect(event.chat_jid).toBe('slack:C456');
    expect(event.sender).toBe('slack:U123');
  });

  it('populates InboundEvent fields', async () => {
    await triggerEvent(makeEvent());
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.id).toBe('1700000000.000100');
    expect(event.content).toBe('hello world');
    expect(event.is_from_me).toBe(false);
    expect(event.verb).toBe(Verb.Message);
    expect(event.platform).toBe(Platform.Slack);
  });

  it('converts ts to ISO timestamp', async () => {
    await triggerEvent(makeEvent({ ts: '1700000000.000100' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(new Date(event.timestamp).getTime()).toBeCloseTo(
      1700000000 * 1000,
      -3,
    );
  });

  it('detects channel as group (isGroup=true)', async () => {
    await triggerEvent(makeEvent({ channel_type: 'channel' }));
    const [, , , , isGroup] = opts.onChatMetadata.mock.calls[0];
    expect(isGroup).toBe(true);
  });

  it('detects DM as non-group (isGroup=false)', async () => {
    await triggerEvent(makeEvent({ channel_type: 'im' }));
    const [, , , , isGroup] = opts.onChatMetadata.mock.calls[0];
    expect(isGroup).toBe(false);
  });

  it('resolves sender real_name from users.info', async () => {
    await triggerEvent(makeEvent());
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.sender_name).toBe('Alice Smith');
  });

  it('falls back to user ID when users.info fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('users.info'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: false, error: 'not_found' }),
        });
      if (url.includes('conversations.info'))
        return ok({ channel: { name: 'g' } });
      return ok({});
    });
    await triggerEvent(makeEvent());
    expect(opts.onMessage.mock.calls[0][1].sender_name).toBe('U123');
  });

  it('passes channel name in #name format', async () => {
    await triggerEvent(makeEvent());
    const [, , chatName] = opts.onChatMetadata.mock.calls[0];
    expect(chatName).toBe('#general');
  });

  it('passes undefined chatName when conversations.info fails', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('conversations.info'))
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: false, error: 'not_in_channel' }),
        });
      if (url.includes('users.info')) return ok({ user: { real_name: 'A' } });
      return ok({});
    });
    await triggerEvent(makeEvent());
    const [, , chatName] = opts.onChatMetadata.mock.calls[0];
    expect(chatName).toBeUndefined();
  });

  it('detects bot mention and strips it from content', async () => {
    await triggerEvent(makeEvent({ text: '<@UBOTID> do this' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.mentions_me).toBe(true);
    expect(event.content).toBe('do this');
  });

  it('strips only bot mention, preserves others', async () => {
    await triggerEvent(makeEvent({ text: '<@UBOTID> hey <@U999>' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.content).toBe('hey <@U999>');
    expect(event.mentions_me).toBe(true);
  });

  it('sets mentions_me=undefined when not mentioned', async () => {
    await triggerEvent(makeEvent({ text: 'plain text' }));
    expect(opts.onMessage.mock.calls[0][1].mentions_me).toBeUndefined();
  });

  it('sets reply_to_id from thread_ts on replies', async () => {
    await triggerEvent(
      makeEvent({ ts: '1700000100.1', thread_ts: '1700000000.1' }),
    );
    expect(opts.onMessage.mock.calls[0][1].reply_to_id).toBe('1700000000.1');
  });

  it('does not set reply_to_id when ts === thread_ts', async () => {
    await triggerEvent(
      makeEvent({ ts: '1700000000.1', thread_ts: '1700000000.1' }),
    );
    expect(opts.onMessage.mock.calls[0][1].reply_to_id).toBeUndefined();
  });

  it('responds to !chatid without calling onMessage', async () => {
    await triggerEvent(makeEvent({ text: '!chatid' }));
    expect(opts.onMessage).not.toHaveBeenCalled();
    const postCall = mockFetch.mock.calls.find((c) =>
      (c[0] as string).includes('chat.postMessage'),
    );
    expect(postCall).toBeDefined();
    const body = postCall![1].body as URLSearchParams;
    expect(body.get('text')).toContain('slack:C456');
  });

  it('ignores malformed JSON frames without throwing', async () => {
    getLastWs()!.emit('message', 'not-json{{{');
    await new Promise((r) => setTimeout(r, 20));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });
});

// --- sendMessage() ---

describe('sendMessage()', () => {
  let ch: SlackUserChannel;

  beforeEach(async () => {
    ch = new SlackUserChannel('xoxc', 'xoxd', makeOpts());
    await ch.connect();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ts: 'sent-ts-1' }),
    });
  });

  it('posts message and returns ts', async () => {
    const result = await ch.sendMessage('slack:C123', 'hello');
    expect(result).toBe('sent-ts-1');
    const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('channel')).toBe('C123');
    expect(body.get('text')).toBe('hello');
  });

  it('strips slack: prefix from jid', async () => {
    await ch.sendMessage('slack:C999', 'hi');
    expect(
      (mockFetch.mock.calls[0][1].body as URLSearchParams).get('channel'),
    ).toBe('C999');
  });

  it('includes thread_ts for reply', async () => {
    await ch.sendMessage('slack:C123', 'reply', { replyTo: '1700000000.1' });
    const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('thread_ts')).toBe('1700000000.1');
  });

  it('omits thread_ts when replyTo not set', async () => {
    await ch.sendMessage('slack:C123', 'plain');
    expect(
      (mockFetch.mock.calls[0][1].body as URLSearchParams).get('thread_ts'),
    ).toBeNull();
  });

  it('splits long messages into MAX_MESSAGE_LEN chunks', async () => {
    await ch.sendMessage('slack:C123', 'x'.repeat(9000));
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('only applies replyTo on first chunk', async () => {
    await ch.sendMessage('slack:C123', 'x'.repeat(9000), {
      replyTo: 'ts-parent',
    });
    const bodies = mockFetch.mock.calls.map(
      (c) => c[1].body as URLSearchParams,
    );
    expect(bodies[0].get('thread_ts')).toBe('ts-parent');
    expect(bodies[1].get('thread_ts')).toBeNull();
    expect(bodies[2].get('thread_ts')).toBeNull();
  });

  it('returns undefined and logs error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'channel_not_found' }),
    });
    const result = await ch.sendMessage('slack:C123', 'hello');
    expect(result).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jid: 'slack:C123' }),
      'Failed to send Slack message',
    );
  });
});

// --- sendDocument() ---

describe('sendDocument()', () => {
  let ch: SlackUserChannel;

  beforeEach(async () => {
    ch = new SlackUserChannel('xoxc', 'xoxd', makeOpts());
    await ch.connect();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  it('uploads file with FormData to files.upload', async () => {
    await ch.sendDocument('slack:C123', '/path/to/report.pdf');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('files.upload');
    expect(opts.body).toBeInstanceOf(FormData);
  });

  it('logs error and does not throw on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: 'not_in_channel' }),
    });
    await expect(
      ch.sendDocument('slack:C123', '/path/file.pdf'),
    ).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jid: 'slack:C123' }),
      'Failed to send Slack file',
    );
  });
});

// --- isConnected() ---

describe('isConnected()', () => {
  it('false before connect', () => {
    expect(new SlackUserChannel('t', 'c', makeOpts()).isConnected()).toBe(
      false,
    );
  });

  it('true after connect', async () => {
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await ch.connect();
    expect(ch.isConnected()).toBe(true);
  });

  it('false after disconnect', async () => {
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await ch.connect();
    await ch.disconnect();
    expect(ch.isConnected()).toBe(false);
  });
});

// --- ownsJid() ---

describe('ownsJid()', () => {
  const ch = new SlackUserChannel('t', 'c', makeOpts());

  it('returns true for slack: prefix', () => {
    expect(ch.ownsJid('slack:C123')).toBe(true);
    expect(ch.ownsJid('slack:D456')).toBe(true);
  });

  it('returns false for other channels', () => {
    expect(ch.ownsJid('telegram:123')).toBe(false);
    expect(ch.ownsJid('')).toBe(false);
    expect(ch.ownsJid('slack')).toBe(false);
  });
});

// --- disconnect() ---

describe('disconnect()', () => {
  it('closes WS', async () => {
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await ch.connect();
    const ws = getLastWs()!;
    await ch.disconnect();
    expect(ws.close).toHaveBeenCalledOnce();
    expect(ch.isConnected()).toBe(false);
  });

  it('no-op when not connected', async () => {
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await ch.disconnect();
    expect(getLastWs()).toBeNull();
  });

  it('disconnect twice is safe', async () => {
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await ch.connect();
    const ws = getLastWs()!;
    await ch.disconnect();
    await ch.disconnect();
    expect(ws.close).toHaveBeenCalledOnce();
  });

  it('WS close after disconnect does not schedule reconnect', async () => {
    vi.useFakeTimers();
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await ch.connect();
    await ch.disconnect();
    getLastWs()!.emit('close');
    await vi.runAllTimersAsync();
    // No additional fetch calls after initial connect
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ attempt: expect.any(Number) }),
      'Slack WS closed, reconnecting',
    );
    vi.useRealTimers();
  });
});

// --- setTyping() ---

describe('setTyping()', () => {
  it('resolves without error (no-op)', async () => {
    const ch = new SlackUserChannel('t', 'c', makeOpts());
    await expect(ch.setTyping('slack:C123', true)).resolves.toBeUndefined();
  });
});
