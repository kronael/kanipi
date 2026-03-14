import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import stopCommand, { setStopDeps } from './stop.js';

const GROUP = {
  name: 'G',
  folder: 'root',
  added_at: '2024-01-01T00:00:00.000Z',
};

const MSG = {
  id: '1',
  jid: 'g@g.us',
  sender: 's',
  content: '/stop',
  timestamp: '2024-01-01T00:00:00.000Z',
};

function makeCtx(sendMessage = vi.fn().mockResolvedValue(undefined)) {
  return {
    group: GROUP,
    groupJid: 'g@g.us',
    message: MSG,
    channel: { sendMessage } as any,
    args: '',
    clearSession: vi.fn(),
  };
}

describe('stop command', () => {
  it('replies "not available" when deps not set', async () => {
    setStopDeps(null as any);
    const ctx = makeCtx();
    await stopCommand.handle(ctx);
    expect(ctx.channel.sendMessage).toHaveBeenCalledWith(
      'g@g.us',
      'stop not available',
    );
  });

  it('calls closeStdin and sends confirmation', async () => {
    const closeStdin = vi.fn();
    setStopDeps({ closeStdin });
    const ctx = makeCtx();
    await stopCommand.handle(ctx);
    expect(closeStdin).toHaveBeenCalledWith('g@g.us');
    expect(ctx.channel.sendMessage).toHaveBeenCalledWith(
      'g@g.us',
      expect.stringContaining('stopping'),
    );
  });
});
