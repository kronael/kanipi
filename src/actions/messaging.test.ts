import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionContext } from '../action-registry.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../db.js', () => ({
  getRouteTargetsForJid: vi.fn(() => []),
}));

import { getRouteTargetsForJid } from '../db.js';
import { sendMessage, sendFile, sendReply } from './messaging.js';

const mockRouteTargets = vi.mocked(getRouteTargetsForJid);

function makeCtx(
  tier: 0 | 1 | 2 | 3,
  sourceGroup = 'root',
  chatJid?: string,
): ActionContext {
  return {
    sourceGroup,
    isRoot: tier === 0,
    tier,
    chatJid,
    sendMessage: vi.fn(),
    sendDocument: vi.fn(),
    getHubForJid: vi.fn(),
    getRoutedJids: vi.fn(),
    getGroupConfig: vi.fn(),
    getDirectChildGroupCount: vi.fn(() => 0),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(),
    getAvailableGroups: vi.fn(),
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn(),
    delegateToParent: vi.fn(),
  };
}

describe('send_message', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tier 0 sends message', async () => {
    const ctx = makeCtx(0);
    const r = await sendMessage.handler(
      { chatJid: 'chat@jid', text: 'hello' },
      ctx,
    );

    expect(ctx.sendMessage).toHaveBeenCalledWith(
      'chat@jid',
      'hello',
      undefined,
    );
    expect(r).toEqual({ sent: true });
  });

  it('tier 2 can send to JID routed to own world', async () => {
    mockRouteTargets.mockReturnValue(['myworld/sibling']);
    const ctx = makeCtx(2, 'myworld/mygroup');
    const r = await sendMessage.handler(
      { chatJid: 'chat@jid', text: 'hi' },
      ctx,
    );

    expect(ctx.sendMessage).toHaveBeenCalledWith('chat@jid', 'hi', undefined);
    expect(r).toEqual({ sent: true });
  });

  it('tier 2 cannot send to JID routed to other world', async () => {
    mockRouteTargets.mockReturnValue(['other']);
    const ctx = makeCtx(2, 'mygroup');

    await expect(
      sendMessage.handler({ chatJid: 'chat@jid', text: 'hi' }, ctx),
    ).rejects.toThrow('unauthorized');
  });

  it('tier 2 cannot send to unrouted JID', async () => {
    mockRouteTargets.mockReturnValue([]);
    const ctx = makeCtx(2, 'mygroup');

    await expect(
      sendMessage.handler({ chatJid: 'chat@jid', text: 'hi' }, ctx),
    ).rejects.toThrow('unauthorized');
  });

  it('tier 1 can send to JID with any route in same world', async () => {
    mockRouteTargets.mockReturnValue(['atlas/deep/child', 'other']);
    const ctx = makeCtx(1, 'atlas');
    const r = await sendMessage.handler(
      { chatJid: 'chat@jid', text: 'hi' },
      ctx,
    );

    expect(ctx.sendMessage).toHaveBeenCalledWith('chat@jid', 'hi', undefined);
    expect(r).toEqual({ sent: true });
  });
});

describe('send_reply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends reply when chatJid is set', async () => {
    const ctx = makeCtx(0, 'root', 'telegram:123');
    const r = await sendReply.handler({ text: 'hello' }, ctx);

    expect(ctx.sendMessage).toHaveBeenCalledWith('telegram:123', 'hello');
    expect(r).toEqual({ sent: true });
  });

  it('throws when chatJid is not set', async () => {
    const ctx = makeCtx(0, 'root', undefined);
    await expect(sendReply.handler({ text: 'hello' }, ctx)).rejects.toThrow(
      'no bound chat JID',
    );
  });
});

describe('send_file', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tier 0 sends file', async () => {
    const ctx = makeCtx(0);
    const r = await sendFile.handler(
      { chatJid: 'chat@jid', filepath: '/tmp/f.txt', filename: 'f.txt' },
      ctx,
    );

    expect(ctx.sendDocument).toHaveBeenCalledWith(
      'chat@jid',
      '/tmp/f.txt',
      'f.txt',
    );
    expect(r).toEqual({ sent: true });
  });

  it('tier 3 (worker) cannot send files', async () => {
    const ctx = makeCtx(3);
    await expect(
      sendFile.handler({ chatJid: 'chat@jid', filepath: '/tmp/f.txt' }, ctx),
    ).rejects.toThrow('unauthorized: workers cannot send files');
  });

  it('tier 2 cannot send to JID routed to other world', async () => {
    mockRouteTargets.mockReturnValue(['other']);
    const ctx = makeCtx(2, 'mygroup');

    await expect(
      sendFile.handler({ chatJid: 'chat@jid', filepath: '/tmp/f.txt' }, ctx),
    ).rejects.toThrow('unauthorized');
  });
});
