import { describe, expect, it, vi } from 'vitest';

import { ActionContext } from '../action-registry.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

import { resetSession } from './session.js';

function makeCtx(): ActionContext {
  return {
    sourceGroup: 'mygroup',
    isRoot: false,
    tier: 2,
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

describe('reset_session', () => {
  it('calls clearSession with sourceGroup and returns reset true', async () => {
    const ctx = makeCtx();
    const r = await resetSession.handler({}, ctx);

    expect(ctx.clearSession).toHaveBeenCalledWith('mygroup');
    expect(r).toEqual({ reset: true });
  });
});
