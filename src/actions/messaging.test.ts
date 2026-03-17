import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionContext } from '../action-registry.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { sendMessage, sendFile, sendReply } from './messaging.js';

function makeCtx(
  tier: 0 | 1 | 2 | 3,
  sourceGroup = 'root',
  chatJid?: string,
  messageId?: string,
): ActionContext {
  return {
    sourceGroup,
    isRoot: tier === 0,
    tier,
    chatJid,
    messageId,
    sendMessage: vi.fn().mockResolvedValue('msg-001'),
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

  it('sends message', async () => {
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
    expect(r).toEqual({ sent: true, messageId: 'msg-001' });
  });

  it('sends with replyTo option', async () => {
    const ctx = makeCtx(0);
    await sendMessage.handler(
      { chatJid: 'chat@jid', text: 'reply', replyTo: 'msg-99' },
      ctx,
    );

    expect(ctx.sendMessage).toHaveBeenCalledWith('chat@jid', 'reply', {
      replyTo: 'msg-99',
    });
  });
});

describe('send_reply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends reply when chatJid is set', async () => {
    const ctx = makeCtx(0, 'root', 'telegram:123', 'orig-msg-42');
    const r = await sendReply.handler({ text: 'hello' }, ctx);

    expect(ctx.sendMessage).toHaveBeenCalledWith('telegram:123', 'hello', {
      replyTo: 'orig-msg-42',
    });
    expect(r).toEqual({ sent: true, messageId: 'msg-001' });
  });

  it('throws when chatJid is not set', async () => {
    const ctx = makeCtx(0, 'root', undefined);
    await expect(sendReply.handler({ text: 'hello' }, ctx)).rejects.toThrow(
      'no bound chat JID',
    );
  });

  it('sends without replyTo when messageId is not set', async () => {
    const ctx = makeCtx(0, 'root', 'telegram:123', undefined);
    await sendReply.handler({ text: 'hello' }, ctx);

    expect(ctx.sendMessage).toHaveBeenCalledWith(
      'telegram:123',
      'hello',
      undefined,
    );
  });
});

describe('send_file', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends file', async () => {
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
});
