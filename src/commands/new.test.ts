import { describe, it, expect, beforeEach, vi } from 'vitest';

import newCommand, { pendingCommandArgs } from './new.js';

vi.mock('../db.js', () => ({
  enqueueSystemMessage: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const GROUP = {
  name: 'G',
  folder: 'root',

  added_at: '2024-01-01T00:00:00.000Z',
};

const MSG = {
  id: '1',
  jid: 'g@g.us',
  sender: 's',
  content: 'hi',
  timestamp: '2024-01-01T00:00:00.000Z',
};

function makeCtx(args: string) {
  return {
    group: GROUP,
    groupJid: 'g@g.us',
    message: MSG,
    channel: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    args,
    clearSession: vi.fn(),
  };
}

beforeEach(() => {
  pendingCommandArgs.clear();
});

describe('new command', () => {
  it('calls clearSession with group.folder', async () => {
    const ctx = makeCtx('');
    await newCommand.handle(ctx);
    expect(ctx.clearSession).toHaveBeenCalledWith('root');
  });

  it('calls channel.sendMessage with confirmation text', async () => {
    const ctx = makeCtx('');
    await newCommand.handle(ctx);
    expect(ctx.channel.sendMessage).toHaveBeenCalledWith(
      'g@g.us',
      expect.stringContaining('fresh'),
    );
  });

  it('stores trimmed args in pendingCommandArgs when args provided', async () => {
    const ctx = makeCtx('  hello world  ');
    await newCommand.handle(ctx);
    expect(pendingCommandArgs.get('g@g.us')).toBe('hello world');
  });

  it('does not set pendingCommandArgs when args is empty', async () => {
    const ctx = makeCtx('');
    await newCommand.handle(ctx);
    expect(pendingCommandArgs.has('g@g.us')).toBe(false);
  });

  it('does not set pendingCommandArgs when args is whitespace only', async () => {
    const ctx = makeCtx('   ');
    await newCommand.handle(ctx);
    expect(pendingCommandArgs.has('g@g.us')).toBe(false);
  });
});
