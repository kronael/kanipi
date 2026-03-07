import { describe, it, expect, vi } from 'vitest';

import { delegateGroup, escalateGroup, registerGroup } from './groups.js';
import type { ActionContext } from '../action-registry.js';

vi.mock('../config.js', () => ({
  isRoot: (folder: string) => folder === 'root',
  permissionTier: (f: string) =>
    f === 'root' ? 0 : (Math.min(f.split('/').length, 3) as 1 | 2 | 3),
}));

vi.mock('../group-folder.js', () => ({
  isValidGroupFolder: (f: string) => /^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(f),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../commands/index.js', () => ({
  writeCommandsXml: vi.fn(),
}));

function makeCtx(
  sourceGroup: string,
  opts?: Partial<ActionContext>,
): ActionContext {
  return {
    sourceGroup,
    isRoot: sourceGroup === 'root',
    tier: (sourceGroup === 'root'
      ? 0
      : Math.min(sourceGroup.split('/').length, 3)) as 0 | 1 | 2 | 3,
    sendMessage: vi.fn(async () => {}),
    sendDocument: vi.fn(async () => {}),
    registeredGroups: vi.fn(() => ({})),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(async () => {}),
    getAvailableGroups: vi.fn(() => []),
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn(async () => {}),
    delegateToParent: vi.fn(async () => {}),
    ...opts,
  };
}

// --- delegate_group action ---

describe('delegateGroup — authorization', () => {
  it('root can delegate to any child', async () => {
    const ctx = makeCtx('root');
    const result = await delegateGroup.handler(
      { group: 'root/code', prompt: 'fix it', chatJid: 'tg/-100' },
      ctx,
    );
    expect(result).toEqual({ queued: true });
    expect(ctx.delegateToChild).toHaveBeenCalledWith(
      'root/code',
      'fix it',
      'tg/-100',
      1,
    );
  });

  it('root cannot delegate to deeply nested child (must be direct)', async () => {
    const ctx = makeCtx('root');
    await expect(
      delegateGroup.handler(
        { group: 'root/code/py', prompt: 'run tests', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('root cannot delegate to cross-world group', async () => {
    const ctx = makeCtx('root');
    await expect(
      delegateGroup.handler(
        { group: 'team/alice', prompt: 'help', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('direct parent can delegate to its child', async () => {
    const ctx = makeCtx('root/code');
    const result = await delegateGroup.handler(
      { group: 'root/code/py', prompt: 'lint', chatJid: 'tg/-100', depth: 1 },
      ctx,
    );
    expect(result).toEqual({ queued: true });
    expect(ctx.delegateToChild).toHaveBeenCalledWith(
      'root/code/py',
      'lint',
      'tg/-100',
      2,
    );
  });

  it('child cannot delegate to sibling', async () => {
    const ctx = makeCtx('root/code');
    await expect(
      delegateGroup.handler(
        { group: 'root/logs', prompt: 'analyze', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('child cannot delegate to ancestor', async () => {
    const ctx = makeCtx('root/code/py');
    await expect(
      delegateGroup.handler(
        { group: 'root/code', prompt: 'do something', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('child cannot delegate to unrelated root', async () => {
    const ctx = makeCtx('root/code');
    await expect(
      delegateGroup.handler(
        { group: 'team/alice', prompt: 'help', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });
});

describe('escalateGroup', () => {
  it('tier 2 group can escalate to direct parent', async () => {
    const ctx = makeCtx('root/code');
    const result = await escalateGroup.handler(
      { prompt: 'need help', chatJid: 'tg/-100' },
      ctx,
    );
    expect(result).toEqual({ queued: true, parent: 'root' });
    expect(ctx.delegateToParent).toHaveBeenCalledWith(
      'root',
      'need help',
      'tg/-100',
      1,
    );
  });

  it('tier 3 group can escalate to direct parent', async () => {
    const ctx = makeCtx('root/code/py');
    const result = await escalateGroup.handler(
      { prompt: 'need parent', chatJid: 'tg/-100', depth: 1 },
      ctx,
    );
    expect(result).toEqual({ queued: true, parent: 'root/code' });
    expect(ctx.delegateToParent).toHaveBeenCalledWith(
      'root/code',
      'need parent',
      'tg/-100',
      2,
    );
  });

  it('root cannot escalate', async () => {
    const ctx = makeCtx('root');
    await expect(
      escalateGroup.handler({ prompt: 'x', chatJid: 'tg/-100' }, ctx),
    ).rejects.toThrow('unauthorized');
  });
});

describe('registerGroup', () => {
  it('root cannot create a new world via action', async () => {
    const ctx = makeCtx('root');
    await expect(
      registerGroup.handler(
        {
          jid: 'world@g.us',
          name: 'World',
          folder: 'atlas',
          trigger: '@Andy',
        },
        ctx,
      ),
    ).rejects.toThrow('CLI-only');
  });

  it('root can create a child inside an existing world', async () => {
    const ctx = makeCtx('root');
    const result = await registerGroup.handler(
      {
        jid: 'child@g.us',
        name: 'Child',
        folder: 'atlas/support',
        trigger: '@Andy',
      },
      ctx,
    );
    expect(result).toEqual({ registered: true });
  });
});

describe('delegateGroup — depth limit', () => {
  it('allows delegation at depth 0 (root spawning first child)', async () => {
    const ctx = makeCtx('root');
    const result = await delegateGroup.handler(
      { group: 'root/code', prompt: 'do it', chatJid: 'tg/-100', depth: 0 },
      ctx,
    );
    expect(result).toEqual({ queued: true });
    expect(ctx.delegateToChild).toHaveBeenCalledWith(
      'root/code',
      'do it',
      'tg/-100',
      1,
    );
  });

  it('allows delegation at depth 2 (just under limit)', async () => {
    const ctx = makeCtx('root');
    const result = await delegateGroup.handler(
      { group: 'root/sub', prompt: 'task', chatJid: 'tg/-100', depth: 2 },
      ctx,
    );
    expect(result).toEqual({ queued: true });
    expect(ctx.delegateToChild).toHaveBeenCalledWith(
      'root/sub',
      'task',
      'tg/-100',
      3,
    );
  });

  it('rejects delegation at depth >= 3', async () => {
    const ctx = makeCtx('root');
    await expect(
      delegateGroup.handler(
        { group: 'root/sub', prompt: 'task', chatJid: 'tg/-100', depth: 3 },
        ctx,
      ),
    ).rejects.toThrow('depth');
  });

  it('rejects at depth 4 as well', async () => {
    const ctx = makeCtx('root');
    await expect(
      delegateGroup.handler(
        { group: 'root/sub', prompt: 'task', chatJid: 'tg/-100', depth: 4 },
        ctx,
      ),
    ).rejects.toThrow('depth');
  });

  it('defaults depth to 0 when omitted', async () => {
    const ctx = makeCtx('root');
    await delegateGroup.handler(
      { group: 'root/code', prompt: 'go', chatJid: 'tg/-100' },
      ctx,
    );
    // depth 0 → passes depth 0+1=1 to delegateToChild
    expect(ctx.delegateToChild).toHaveBeenCalledWith(
      'root/code',
      'go',
      'tg/-100',
      1,
    );
  });
});
