import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';

// --- Hoisted mocks ---

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../logger.js', () => ({ logger: mockLogger }));
vi.mock('fs', () => ({
  default: { createReadStream: vi.fn(() => new Readable({ read() {} })) },
  createReadStream: vi.fn(() => new Readable({ read() {} })),
}));

// App mock: captures message handler + app.start/stop calls
let capturedMessageHandler:
  | ((args: { message: unknown }) => Promise<void>)
  | null = null;
const mockPostMessage = vi.fn().mockResolvedValue({ ts: 'sent-ts-1' });
const mockFilesUpload = vi.fn().mockResolvedValue({});
const mockUsersInfo = vi.fn();
const mockConversationsInfo = vi.fn();
const mockAuthTest = vi.fn().mockResolvedValue({ user_id: 'UBOTID' });
const mockAppStart = vi.fn().mockResolvedValue(undefined);
const mockAppStop = vi.fn().mockResolvedValue(undefined);

vi.mock('@slack/bolt', () => {
  class App {
    client = {
      auth: { test: mockAuthTest },
      chat: { postMessage: mockPostMessage },
      files: { upload: mockFilesUpload },
      users: { info: mockUsersInfo },
      conversations: { info: mockConversationsInfo },
    };
    message(handler: (args: { message: unknown }) => Promise<void>) {
      capturedMessageHandler = handler;
    }
    start = mockAppStart;
    stop = mockAppStop;
  }
  return { App, LogLevel: { WARN: 'WARN' } };
});

import { SlackChannel } from './slack.js';
import { Verb, Platform } from '../types.js';

// --- helpers ---

function makeOpts() {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
  };
}

function makeMsg(overrides: Record<string, unknown> = {}) {
  return {
    user: 'U123',
    channel: 'C456',
    ts: '1700000000.000100',
    text: 'hello world',
    channel_type: 'channel',
    ...overrides,
  };
}

async function triggerMessage(msg: Record<string, unknown>) {
  if (!capturedMessageHandler) throw new Error('No message handler registered');
  await capturedMessageHandler({ message: msg });
}

// --- tests ---

beforeEach(() => {
  vi.clearAllMocks();
  capturedMessageHandler = null;
  mockUsersInfo.mockResolvedValue({
    user: { real_name: 'Alice Smith', name: 'alice' },
  });
  mockConversationsInfo.mockResolvedValue({ channel: { name: 'general' } });
  mockPostMessage.mockResolvedValue({ ts: 'sent-ts-1' });
});

describe('constructor', () => {
  it('starts disconnected', () => {
    const ch = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    expect(ch.isConnected()).toBe(false);
  });
});

describe('connect()', () => {
  it('calls auth.test, registers message handler, and calls app.start', async () => {
    const ch = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    await ch.connect();
    expect(mockAuthTest).toHaveBeenCalledOnce();
    expect(mockAppStart).toHaveBeenCalledOnce();
    expect(capturedMessageHandler).not.toBeNull();
    expect(ch.isConnected()).toBe(true);
  });

  it('logs connected with botUserId', async () => {
    const ch = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    await ch.connect();
    expect(mockLogger.info).toHaveBeenCalledWith(
      { botUserId: 'UBOTID' },
      'Slack connected',
    );
  });

  it('propagates auth.test failure', async () => {
    mockAuthTest.mockRejectedValueOnce(new Error('invalid_auth'));
    const ch = new SlackChannel('bad-token', 'xapp-token', makeOpts());
    await expect(ch.connect()).rejects.toThrow('invalid_auth');
  });

  it('propagates app.start failure', async () => {
    mockAppStart.mockRejectedValueOnce(new Error('no_socket'));
    const ch = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    await expect(ch.connect()).rejects.toThrow('no_socket');
  });
});

describe('message handler', () => {
  let ch: SlackChannel;
  let opts: ReturnType<typeof makeOpts>;

  beforeEach(async () => {
    opts = makeOpts();
    ch = new SlackChannel('xoxb-token', 'xapp-token', opts);
    await ch.connect();
  });

  it('processes a normal message and calls both callbacks', async () => {
    await triggerMessage(makeMsg());
    expect(opts.onChatMetadata).toHaveBeenCalledOnce();
    expect(opts.onMessage).toHaveBeenCalledOnce();
  });

  it('skips bot_message subtype', async () => {
    await triggerMessage(makeMsg({ subtype: 'bot_message' }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips messages with bot_id', async () => {
    await triggerMessage(makeMsg({ bot_id: 'BBOT123' }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips missing user field', async () => {
    await triggerMessage(makeMsg({ user: undefined }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips missing channel field', async () => {
    await triggerMessage(makeMsg({ channel: undefined }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips missing ts field', async () => {
    await triggerMessage(makeMsg({ ts: undefined }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('skips own user messages', async () => {
    await triggerMessage(makeMsg({ user: 'UBOTID' }));
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('passes correct chatJid and sender to onMessage', async () => {
    await triggerMessage(makeMsg());
    const [chatJid, event] = opts.onMessage.mock.calls[0];
    expect(chatJid).toBe('slack:C456');
    expect(event.chat_jid).toBe('slack:C456');
    expect(event.sender).toBe('slack:U123');
  });

  it('populates InboundEvent fields correctly', async () => {
    await triggerMessage(makeMsg());
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.id).toBe('1700000000.000100');
    expect(event.content).toBe('hello world');
    expect(event.is_from_me).toBe(false);
    expect(event.verb).toBe(Verb.Message);
    expect(event.platform).toBe(Platform.Slack);
  });

  it('converts ts to ISO timestamp', async () => {
    await triggerMessage(makeMsg({ ts: '1700000000.000100' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(event.timestamp).getTime()).toBeCloseTo(
      1700000000 * 1000,
      -3,
    );
  });

  it('detects channel as group (isGroup=true)', async () => {
    await triggerMessage(makeMsg({ channel_type: 'channel' }));
    const [, , , , isGroup] = opts.onChatMetadata.mock.calls[0];
    expect(isGroup).toBe(true);
  });

  it('detects DM as non-group (isGroup=false)', async () => {
    await triggerMessage(makeMsg({ channel_type: 'im' }));
    const [, , , , isGroup] = opts.onChatMetadata.mock.calls[0];
    expect(isGroup).toBe(false);
  });

  it('passes channel name in #name format', async () => {
    await triggerMessage(makeMsg());
    const [, , chatName] = opts.onChatMetadata.mock.calls[0];
    expect(chatName).toBe('#general');
  });

  it('passes undefined chatName when conversations.info fails', async () => {
    mockConversationsInfo.mockRejectedValueOnce(new Error('not_in_channel'));
    await triggerMessage(makeMsg());
    const [, , chatName] = opts.onChatMetadata.mock.calls[0];
    expect(chatName).toBeUndefined();
  });

  it('uses real_name from users.info', async () => {
    await triggerMessage(makeMsg());
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.sender_name).toBe('Alice Smith');
  });

  it('falls back to name when real_name absent', async () => {
    mockUsersInfo.mockResolvedValueOnce({ user: { name: 'alice' } });
    await triggerMessage(makeMsg());
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.sender_name).toBe('alice');
  });

  it('falls back to user ID when users.info fails', async () => {
    mockUsersInfo.mockRejectedValueOnce(new Error('user_not_found'));
    await triggerMessage(makeMsg());
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.sender_name).toBe('U123');
  });

  it('sets mentions_me=true when bot is mentioned', async () => {
    await triggerMessage(makeMsg({ text: '<@UBOTID> hello' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.mentions_me).toBe(true);
  });

  it('strips only the bot mention from content', async () => {
    await triggerMessage(makeMsg({ text: '<@UBOTID> hey <@U999> do this' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.content).toBe('hey <@U999> do this');
    expect(event.mentions_me).toBe(true);
  });

  it('preserves other user mentions when not mentioning bot', async () => {
    await triggerMessage(makeMsg({ text: 'hey <@U999> do this' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.content).toBe('hey <@U999> do this');
    expect(event.mentions_me).toBeFalsy();
  });

  it('sets mentions_me=undefined when not mentioned', async () => {
    await triggerMessage(makeMsg({ text: 'plain message' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.mentions_me).toBeUndefined();
  });

  it('populates reply_to_id from thread_ts on replies', async () => {
    await triggerMessage(
      makeMsg({ ts: '1700000100.000001', thread_ts: '1700000000.000001' }),
    );
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.reply_to_id).toBe('1700000000.000001');
  });

  it('does not set reply_to_id on top-level thread message (ts === thread_ts)', async () => {
    await triggerMessage(
      makeMsg({ ts: '1700000000.000001', thread_ts: '1700000000.000001' }),
    );
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.reply_to_id).toBeUndefined();
  });

  it('does not set reply_to_id when thread_ts absent', async () => {
    await triggerMessage(makeMsg({ thread_ts: undefined }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.reply_to_id).toBeUndefined();
  });

  it('responds to !chatid and does not call onMessage', async () => {
    await triggerMessage(makeMsg({ text: '!chatid' }));
    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'C456',
      text: 'Chat ID: `slack:C456`',
    });
    expect(opts.onMessage).not.toHaveBeenCalled();
  });

  it('handles empty text gracefully', async () => {
    await triggerMessage(makeMsg({ text: '' }));
    const event = opts.onMessage.mock.calls[0][1];
    expect(event.content).toBe('');
  });
});

describe('sendMessage()', () => {
  let ch: SlackChannel;

  beforeEach(async () => {
    ch = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    await ch.connect();
  });

  it('returns undefined when not connected', async () => {
    const fresh = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    const result = await fresh.sendMessage('slack:C123', 'hello');
    expect(result).toBeUndefined();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('posts message and returns ts', async () => {
    const result = await ch.sendMessage('slack:C123', 'hello');
    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'hello',
    });
    expect(result).toBe('sent-ts-1');
  });

  it('strips slack: prefix from jid', async () => {
    await ch.sendMessage('slack:C999', 'hi');
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C999' }),
    );
  });

  it('includes thread_ts for reply when opts.replyTo set', async () => {
    await ch.sendMessage('slack:C123', 'reply', { replyTo: '1700000000.1' });
    expect(mockPostMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: 'reply',
      thread_ts: '1700000000.1',
    });
  });

  it('omits thread_ts when opts.replyTo not set', async () => {
    await ch.sendMessage('slack:C123', 'plain');
    const call = mockPostMessage.mock.calls[0][0];
    expect(call).not.toHaveProperty('thread_ts');
  });

  it('splits long messages into chunks of MAX_MESSAGE_LEN', async () => {
    const long = 'x'.repeat(9000);
    await ch.sendMessage('slack:C123', long);
    expect(mockPostMessage).toHaveBeenCalledTimes(3); // 9000 / 4000 = 3 chunks
  });

  it('only applies replyTo on first chunk', async () => {
    const long = 'x'.repeat(9000);
    await ch.sendMessage('slack:C123', long, { replyTo: 'ts-parent' });
    const calls = mockPostMessage.mock.calls;
    expect(calls[0][0]).toHaveProperty('thread_ts', 'ts-parent');
    expect(calls[1][0]).not.toHaveProperty('thread_ts');
    expect(calls[2][0]).not.toHaveProperty('thread_ts');
  });

  it('returns undefined and logs error on postMessage failure', async () => {
    mockPostMessage.mockRejectedValueOnce(new Error('channel_not_found'));
    const result = await ch.sendMessage('slack:C123', 'hello');
    expect(result).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jid: 'slack:C123' }),
      'Failed to send Slack message',
    );
  });
});

describe('sendDocument()', () => {
  let ch: SlackChannel;

  beforeEach(async () => {
    ch = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    await ch.connect();
  });

  it('returns without calling API when not connected', async () => {
    const fresh = new SlackChannel('xoxb-token', 'xapp-token', makeOpts());
    await fresh.sendDocument('slack:C123', '/tmp/file.pdf');
    expect(mockFilesUpload).not.toHaveBeenCalled();
  });

  it('uploads file with correct channel and filename', async () => {
    await ch.sendDocument('slack:C123', '/path/to/report.pdf');
    expect(mockFilesUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: 'C123',
        filename: 'report.pdf',
      }),
    );
  });

  it('uses provided filename override', async () => {
    await ch.sendDocument('slack:C123', '/path/to/tmp-abc.pdf', 'report.pdf');
    expect(mockFilesUpload).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'report.pdf' }),
    );
  });

  it('logs error and does not throw on API failure', async () => {
    mockFilesUpload.mockRejectedValueOnce(new Error('not_in_channel'));
    await expect(
      ch.sendDocument('slack:C123', '/path/file.pdf'),
    ).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jid: 'slack:C123' }),
      'Failed to send Slack file',
    );
  });
});

describe('isConnected()', () => {
  it('false before connect', () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    expect(ch.isConnected()).toBe(false);
  });

  it('true after connect', async () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    await ch.connect();
    expect(ch.isConnected()).toBe(true);
  });

  it('false after disconnect', async () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    await ch.connect();
    await ch.disconnect();
    expect(ch.isConnected()).toBe(false);
  });
});

describe('ownsJid()', () => {
  const ch = new SlackChannel('t', 'a', makeOpts());

  it('returns true for slack: prefix', () => {
    expect(ch.ownsJid('slack:C123')).toBe(true);
    expect(ch.ownsJid('slack:D456')).toBe(true);
    expect(ch.ownsJid('slack:')).toBe(true);
  });

  it('returns false for other channels', () => {
    expect(ch.ownsJid('telegram:123')).toBe(false);
    expect(ch.ownsJid('discord:123')).toBe(false);
    expect(ch.ownsJid('email:foo')).toBe(false);
    expect(ch.ownsJid('')).toBe(false);
    expect(ch.ownsJid('slack')).toBe(false);
  });
});

describe('disconnect()', () => {
  it('calls app.stop and sets app to null', async () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    await ch.connect();
    await ch.disconnect();
    expect(mockAppStop).toHaveBeenCalledOnce();
    expect(ch.isConnected()).toBe(false);
  });

  it('no-op when already disconnected', async () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    await ch.disconnect(); // never connected
    expect(mockAppStop).not.toHaveBeenCalled();
  });

  it('disconnect twice is safe', async () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    await ch.connect();
    await ch.disconnect();
    await ch.disconnect();
    expect(mockAppStop).toHaveBeenCalledOnce();
  });
});

describe('setTyping()', () => {
  it('resolves without error (no-op)', async () => {
    const ch = new SlackChannel('t', 'a', makeOpts());
    await expect(ch.setTyping('slack:C123', true)).resolves.toBeUndefined();
    await expect(ch.setTyping('slack:C123', false)).resolves.toBeUndefined();
  });
});
