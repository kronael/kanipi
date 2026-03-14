import { describe, it, expect, vi } from 'vitest';

import pingCommand from './ping.js';

vi.mock('../config.js', () => ({ ASSISTANT_NAME: 'TestBot' }));

const MSG = {
  id: '1',
  jid: 'g@g.us',
  sender: 's',
  content: 'hi',
  timestamp: '2024-01-01T00:00:00.000Z',
};

const GROUP = {
  name: 'G',
  folder: 'root',

  added_at: '2024-01-01T00:00:00.000Z',
};

describe('ping command', () => {
  it('calls channel.sendMessage with bot name', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    await pingCommand.handle({
      group: GROUP,
      groupJid: 'g@g.us',
      message: MSG,
      channel: { sendMessage },
      args: '',
      clearSession: vi.fn(),
    });
    expect(sendMessage).toHaveBeenCalledWith(
      'g@g.us',
      expect.stringContaining('TestBot'),
    );
  });
});
