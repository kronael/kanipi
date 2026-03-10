import { describe, it, expect, vi } from 'vitest';

import chatidCommand from './chatid.js';

const MSG = {
  id: '1',
  chat_jid: 'room@g.us',
  sender: 's',
  content: 'hi',
  timestamp: '2024-01-01T00:00:00.000Z',
};

const GROUP = {
  name: 'G',
  folder: 'main',

  added_at: '2024-01-01T00:00:00.000Z',
};

describe('chatid command', () => {
  it('calls channel.sendMessage with the groupJid', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    await chatidCommand.handle({
      group: GROUP,
      groupJid: 'room@g.us',
      message: MSG,
      channel: { sendMessage },
      args: '',
      clearSession: vi.fn(),
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'room@g.us',
      expect.stringContaining('room@g.us'),
    );
  });
});
