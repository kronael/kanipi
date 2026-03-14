import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStoreMessage } = vi.hoisted(() => ({
  mockStoreMessage: vi.fn(),
}));

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'TestBot',
}));

vi.mock('../db.js', () => ({
  storeMessage: mockStoreMessage,
}));

import { LocalChannel } from './local.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('LocalChannel basics', () => {
  it('name is local', () => {
    const ch = new LocalChannel();
    expect(ch.name).toBe('local');
  });
});

describe('ownsJid', () => {
  it('owns local: prefix', () => {
    const ch = new LocalChannel();
    expect(ch.ownsJid('local:main')).toBe(true);
  });

  it('does not own non-local JIDs', () => {
    const ch = new LocalChannel();
    expect(ch.ownsJid('web:main')).toBe(false);
    expect(ch.ownsJid('')).toBe(false);
    expect(ch.ownsJid('localhost:foo')).toBe(false);
  });
});

describe('sendMessage', () => {
  it('stores message with correct fields and returns id', async () => {
    const ch = new LocalChannel();
    const id = await ch.sendMessage('local:main', 'hello world');
    expect(id).toMatch(/^local-\d+-[a-z0-9]+$/);
    expect(mockStoreMessage).toHaveBeenCalledOnce();
    const stored = mockStoreMessage.mock.calls[0][0];
    expect(stored.chat_jid).toBe('local:main');
    expect(stored.sender).toBe('TestBot');
    expect(stored.sender_name).toBe('TestBot');
    expect(stored.content).toBe('hello world');
    expect(stored.is_from_me).toBe(true);
    expect(stored.is_bot_message).toBe(false);
    expect(stored.timestamp).toBeTruthy();
  });

  it('generates unique ids across calls', async () => {
    const ch = new LocalChannel();
    const id1 = await ch.sendMessage('local:a', 'msg1');
    const id2 = await ch.sendMessage('local:b', 'msg2');
    expect(id1).not.toBe(id2);
  });
});

describe('sendDocument', () => {
  it('throws not supported error', async () => {
    const ch = new LocalChannel();
    await expect(ch.sendDocument()).rejects.toThrow(
      'local: sendDocument not supported',
    );
  });
});
