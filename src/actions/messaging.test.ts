import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActionContext } from '../action-registry.js';
import { GroupConfig } from '../db.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { sendMessage, sendFile } from './messaging.js';

function makeCtx(
  tier: 0 | 1 | 2 | 3,
  sourceGroup = 'main',
  groups?: Record<string, GroupConfig>,
): ActionContext {
  return {
    sourceGroup,
    isRoot: tier === 0,
    tier,
    sendMessage: vi.fn(),
    sendDocument: vi.fn(),
    getDefaultTarget: vi.fn((jid: string) => groups?.[jid]?.folder ?? null),
    getRoutedJids: vi.fn(() => Object.keys(groups ?? {})),
    getGroupConfig: vi.fn((folder: string) =>
      Object.values(groups ?? {}).find((g) => g.folder === folder),
    ),
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

function makeGroup(folder: string): GroupConfig {
  return {
    name: 'test',
    folder,
    added_at: new Date().toISOString(),
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

    expect(ctx.sendMessage).toHaveBeenCalledWith('chat@jid', 'hello');
    expect(r).toEqual({ sent: true });
  });

  it('tier 2 can send to own group', async () => {
    const groups = { 'chat@jid': makeGroup('mygroup') };
    const ctx = makeCtx(2, 'mygroup', groups);
    const r = await sendMessage.handler(
      { chatJid: 'chat@jid', text: 'hi' },
      ctx,
    );

    expect(ctx.sendMessage).toHaveBeenCalledWith('chat@jid', 'hi');
    expect(r).toEqual({ sent: true });
  });

  it('tier 2 cannot send to other group', async () => {
    const groups = { 'chat@jid': makeGroup('other') };
    const ctx = makeCtx(2, 'mygroup', groups);

    await expect(
      sendMessage.handler({ chatJid: 'chat@jid', text: 'hi' }, ctx),
    ).rejects.toThrow('unauthorized');
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

  it('tier 2 cannot send to other group', async () => {
    const groups = { 'chat@jid': makeGroup('other') };
    const ctx = makeCtx(2, 'mygroup', groups);

    await expect(
      sendFile.handler({ chatJid: 'chat@jid', filepath: '/tmp/f.txt' }, ctx),
    ).rejects.toThrow('unauthorized');
  });
});
