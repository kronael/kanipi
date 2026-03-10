import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionContext } from '../action-registry.js';

vi.mock('../db.js', () => ({
  storeMessage: vi.fn(),
  clearChatErrored: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { storeMessage, clearChatErrored } from '../db.js';
import { injectMessage } from './inject.js';

function makeCtx(tier: 0 | 1 | 2 | 3): ActionContext {
  return {
    sourceGroup: 'main',
    isRoot: tier === 0,
    tier,
    sendMessage: vi.fn(),
    sendDocument: vi.fn(),
    getDefaultTarget: vi.fn(),
    getRoutedJids: vi.fn(),
    getGroupConfig: vi.fn(),
    getDirectChildGroupCount: vi.fn(),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(),
    getAvailableGroups: vi.fn(),
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn(),
    delegateToParent: vi.fn(),
  };
}

describe('inject_message', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tier 0 (root) injects successfully', async () => {
    const ctx = makeCtx(0);
    const r = (await injectMessage.handler(
      { chatJid: 'chat@jid', content: 'hello' },
      ctx,
    )) as { injected: boolean; id: string };

    expect(r.injected).toBe(true);
    expect(r.id).toMatch(/^inject-/);
    expect(storeMessage).toHaveBeenCalledOnce();
    expect(clearChatErrored).toHaveBeenCalledWith('chat@jid');
  });

  it('tier 1 (world) injects successfully', async () => {
    const ctx = makeCtx(1);
    const r = (await injectMessage.handler(
      { chatJid: 'chat@jid', content: 'hello' },
      ctx,
    )) as { injected: boolean; id: string };

    expect(r.injected).toBe(true);
    expect(storeMessage).toHaveBeenCalledOnce();
  });

  it('tier 2 (agent) is unauthorized', async () => {
    const ctx = makeCtx(2);
    await expect(
      injectMessage.handler({ chatJid: 'c@j', content: 'x' }, ctx),
    ).rejects.toThrow('unauthorized: root/world only');
  });

  it('tier 3 (worker) is unauthorized', async () => {
    const ctx = makeCtx(3);
    await expect(
      injectMessage.handler({ chatJid: 'c@j', content: 'x' }, ctx),
    ).rejects.toThrow('unauthorized: root/world only');
  });

  it('rejects missing chatJid', async () => {
    const ctx = makeCtx(0);
    await expect(
      injectMessage.handler({ content: 'hello' }, ctx),
    ).rejects.toThrow();
  });

  it('rejects missing content', async () => {
    const ctx = makeCtx(0);
    await expect(
      injectMessage.handler({ chatJid: 'c@j' }, ctx),
    ).rejects.toThrow();
  });
});
