import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  addRouteAction,
  delegateGroup,
  deleteRouteAction,
  escalateGroup,
  getRoutes,
  registerGroup,
} from './groups.js';
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

vi.mock('../db.js', () => ({
  getRoutesForJid: vi.fn(),
  setRoutesForJid: vi.fn(),
  addRoute: vi.fn(),
  getRouteById: vi.fn(),
  deleteRoute: vi.fn(),
}));

vi.mock('../router.js', () => ({
  isAuthorizedRoutingTarget: vi.fn(),
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
    getHubForJid: vi.fn((_jid: string) => null),
    getRoutedJids: vi.fn(() => []),
    getGroupConfig: vi.fn((_folder: string) => undefined),
    getDirectChildGroupCount: vi.fn(() => 0),
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
  beforeEach(async () => {
    const { isAuthorizedRoutingTarget } = await import('../router.js');
    vi.mocked(isAuthorizedRoutingTarget).mockImplementation(
      (source, target) => {
        if (source.split('/')[0] === 'root') return true;
        const srcWorld = source.split('/')[0];
        const tgtWorld = target.split('/')[0];
        if (srcWorld !== tgtWorld) return false;
        return target.startsWith(source + '/');
      },
    );
  });

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

  it('root can delegate to deeply nested descendant', async () => {
    const ctx = makeCtx('root');
    const result = await delegateGroup.handler(
      { group: 'root/code/py', prompt: 'run tests', chatJid: 'tg/-100' },
      ctx,
    );
    expect(result).toEqual({ queued: true });
  });

  it('root can delegate cross-world', async () => {
    const ctx = makeCtx('root');
    const result = await delegateGroup.handler(
      { group: 'team/alice', prompt: 'help', chatJid: 'tg/-100' },
      ctx,
    );
    expect(result).toEqual({ queued: true });
  });

  it('root subgroup can delegate cross-world', async () => {
    const ctx = makeCtx('root/code');
    const result = await delegateGroup.handler(
      { group: 'team/alice', prompt: 'help', chatJid: 'tg/-100' },
      ctx,
    );
    expect(result).toEqual({ queued: true });
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

  it('non-root child cannot delegate to sibling', async () => {
    const ctx = makeCtx('atlas/code');
    await expect(
      delegateGroup.handler(
        { group: 'atlas/logs', prompt: 'analyze', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('non-root child cannot delegate to ancestor', async () => {
    const ctx = makeCtx('atlas/code/py');
    await expect(
      delegateGroup.handler(
        { group: 'atlas/code', prompt: 'do something', chatJid: 'tg/-100' },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });

  it('non-root cannot delegate cross-world', async () => {
    const ctx = makeCtx('atlas/code');
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

describe('registerGroup — max_children', () => {
  it('allows registration when under max_children limit', async () => {
    const ctx = makeCtx('root', {
      getGroupConfig: vi.fn((folder: string) =>
        folder === 'root'
          ? {
              folder: 'root',
              name: 'Root',
              added_at: '',
              maxChildren: 3,
            }
          : undefined,
      ),
      getDirectChildGroupCount: vi.fn(() => 2),
    });
    const result = await registerGroup.handler(
      { jid: 'new@g.us', name: 'New', folder: 'root/c' },
      ctx,
    );
    expect(result).toEqual({ registered: true });
    expect(ctx.registerGroup).toHaveBeenCalled();
  });

  it('blocks registration when max_children limit is reached', async () => {
    const ctx = makeCtx('root', {
      getGroupConfig: vi.fn((folder: string) =>
        folder === 'root'
          ? {
              folder: 'root',
              name: 'Root',
              added_at: '',
              maxChildren: 2,
            }
          : undefined,
      ),
      getDirectChildGroupCount: vi.fn(() => 2),
    });
    const result = await registerGroup.handler(
      { jid: 'new@g.us', name: 'New', folder: 'root/c' },
      ctx,
    );
    expect(result).toEqual({
      registered: false,
      reason: 'max_children_exceeded',
      fallback: 'root',
    });
    expect(ctx.registerGroup).not.toHaveBeenCalled();
  });

  it('blocks registration when max_children=0 (spawning disabled)', async () => {
    const ctx = makeCtx('root', {
      getGroupConfig: vi.fn((folder: string) =>
        folder === 'root'
          ? {
              folder: 'root',
              name: 'Root',
              added_at: '',
              maxChildren: 0,
            }
          : undefined,
      ),
    });
    const result = await registerGroup.handler(
      { jid: 'new@g.us', name: 'New', folder: 'root/c' },
      ctx,
    );
    expect(result).toEqual({
      registered: false,
      reason: 'spawning_disabled',
      fallback: 'root',
    });
    expect(ctx.registerGroup).not.toHaveBeenCalled();
  });

  it('uses default max_children=50 when not configured', async () => {
    const ctx = makeCtx('root', {
      getGroupConfig: vi.fn((folder: string) =>
        folder === 'root'
          ? { folder: 'root', name: 'Root', added_at: '' }
          : undefined,
      ),
      getDirectChildGroupCount: vi.fn(() => 49),
    });
    const result = await registerGroup.handler(
      { jid: 'new@g.us', name: 'New', folder: 'root/c50' },
      ctx,
    );
    expect(result).toEqual({ registered: true });
    expect(ctx.registerGroup).toHaveBeenCalled();
  });

  it('blocks at default limit of 50', async () => {
    const ctx = makeCtx('root', {
      getGroupConfig: vi.fn((folder: string) =>
        folder === 'root'
          ? { folder: 'root', name: 'Root', added_at: '' }
          : undefined,
      ),
      getDirectChildGroupCount: vi.fn(() => 50),
    });
    const result = await registerGroup.handler(
      { jid: 'new@g.us', name: 'New', folder: 'root/c51' },
      ctx,
    );
    expect(result).toEqual({
      registered: false,
      reason: 'max_children_exceeded',
      fallback: 'root',
    });
    expect(ctx.registerGroup).not.toHaveBeenCalled();
  });

  it('does not apply max_children check for non-direct-child folders', async () => {
    const ctx = makeCtx('root', {
      getGroupConfig: vi.fn((folder: string) =>
        folder === 'root'
          ? {
              folder: 'root',
              name: 'Root',
              added_at: '',
              maxChildren: 0,
            }
          : undefined,
      ),
    });
    const result = await registerGroup.handler(
      { jid: 'new@g.us', name: 'New', folder: 'root/a/b' },
      ctx,
    );
    expect(result).toEqual({ registered: true });
    expect(ctx.registerGroup).toHaveBeenCalled();
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

// --- Routing actions ---

describe('getRoutes', () => {
  it('returns routes for JID when tier 1', async () => {
    const { getRoutesForJid } = await import('../db.js');
    vi.mocked(getRoutesForJid).mockReturnValue([
      { id: 1, seq: 0, type: 'command', match: 'help', target: 'root/support' },
      { id: 2, seq: 1, type: 'default', match: null, target: 'root/default' },
    ]);
    const ctx = makeCtx('root');
    const result = await getRoutes.handler({ jid: 'tg/-100' }, ctx);
    expect(result).toEqual({
      jid: 'tg/-100',
      routes: [
        {
          id: 1,
          seq: 0,
          type: 'command',
          match: 'help',
          target: 'root/support',
        },
        { id: 2, seq: 1, type: 'default', match: null, target: 'root/default' },
      ],
    });
  });

  it('rejects tier 2 group', async () => {
    const ctx = makeCtx('root/code');
    await expect(getRoutes.handler({ jid: 'tg/-100' }, ctx)).rejects.toThrow(
      'unauthorized',
    );
  });

  it('rejects tier 3 group', async () => {
    const ctx = makeCtx('root/code/py');
    await expect(getRoutes.handler({ jid: 'tg/-100' }, ctx)).rejects.toThrow(
      'unauthorized',
    );
  });
});

describe('addRouteAction', () => {
  it('adds single route when tier 1 and authorized', async () => {
    const { addRoute } = await import('../db.js');
    const { isAuthorizedRoutingTarget } = await import('../router.js');
    vi.mocked(isAuthorizedRoutingTarget).mockReturnValue(true);
    vi.mocked(addRoute).mockReturnValue(5);
    const ctx = makeCtx('root');
    const route = {
      seq: 0,
      type: 'keyword' as const,
      match: 'error',
      target: 'root/debug',
    };
    const result = await addRouteAction.handler({ jid: 'tg/-100', route }, ctx);
    expect(result).toEqual({ jid: 'tg/-100', id: 5, route });
    expect(addRoute).toHaveBeenCalledWith('tg/-100', route);
  });

  it('rejects tier 2 group', async () => {
    const ctx = makeCtx('root/code');
    const route = {
      seq: 0,
      type: 'default' as const,
      match: null,
      target: 'root',
    };
    await expect(
      addRouteAction.handler({ jid: 'tg/-100', route }, ctx),
    ).rejects.toThrow('unauthorized');
  });

  it('denies tier 1 routing to unauthorized target', async () => {
    const { isAuthorizedRoutingTarget } = await import('../router.js');
    vi.mocked(isAuthorizedRoutingTarget).mockReturnValue(false);
    const ctx = makeCtx('atlas/code');
    const route = {
      seq: 0,
      type: 'default' as const,
      match: null,
      target: 'team/bot',
    };
    await expect(
      addRouteAction.handler({ jid: 'tg/-100', route }, ctx),
    ).rejects.toThrow('unauthorized');
  });
});

describe('deleteRouteAction', () => {
  it('deletes route by ID when tier 0', async () => {
    const { getRouteById, deleteRoute } = await import('../db.js');
    const { isAuthorizedRoutingTarget } = await import('../router.js');
    vi.mocked(getRouteById).mockReturnValue({
      id: 3,
      seq: 0,
      type: 'command',
      match: 'help',
      target: 'root/support',
    });
    vi.mocked(isAuthorizedRoutingTarget).mockReturnValue(true);
    const ctx = makeCtx('root');
    const result = await deleteRouteAction.handler({ id: 3 }, ctx);
    expect(result).toEqual({ deleted: true, id: 3 });
    expect(deleteRoute).toHaveBeenCalledWith(3);
  });

  it('throws route not found error', async () => {
    const { getRouteById } = await import('../db.js');
    vi.mocked(getRouteById).mockReturnValue(undefined);
    const ctx = makeCtx('root');
    await expect(deleteRouteAction.handler({ id: 999 }, ctx)).rejects.toThrow(
      'route not found: 999',
    );
  });

  it('rejects tier 2 group', async () => {
    const ctx = makeCtx('root/code');
    await expect(deleteRouteAction.handler({ id: 1 }, ctx)).rejects.toThrow(
      'unauthorized',
    );
  });

  it('tier 0 (root) can delete any route', async () => {
    const { getRouteById, deleteRoute } = await import('../db.js');
    vi.mocked(getRouteById).mockReturnValue({
      id: 10,
      seq: 0,
      type: 'default',
      match: null,
      target: 'any/target',
    });
    const ctx = makeCtx('root');
    const result = await deleteRouteAction.handler({ id: 10 }, ctx);
    expect(result).toEqual({ deleted: true, id: 10 });
    expect(deleteRoute).toHaveBeenCalledWith(10);
  });
});
