import { describe, it, expect, vi, beforeEach } from 'vitest';

import { _initTestDatabase } from '../db.js';
import { getGrantOverrides } from '../grants.js';
import { getGrants, setGrants } from './grants-actions.js';
import type { ActionContext } from '../action-registry.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../config.js', () => ({
  isRoot: (f: string) => f === 'root',
  permissionTier: (f: string) =>
    f === 'root' ? 0 : (Math.min(f.split('/').length, 3) as 0 | 1 | 2 | 3),
}));

function makeCtx(tier: 0 | 1 | 2 | 3 = 0): ActionContext {
  return {
    sourceGroup: tier === 0 ? 'root' : 'root/child',
    isRoot: tier === 0,
    tier,
    sendMessage: vi.fn(async () => undefined),
    sendDocument: vi.fn(async () => {}),
    getHubForJid: vi.fn(() => null),
    getRoutedJids: vi.fn(() => []),
    getGroupConfig: vi.fn(() => undefined),
    getDirectChildGroupCount: vi.fn(() => 0),
    registerGroup: vi.fn(),
    syncGroupMetadata: vi.fn(async () => {}),
    getAvailableGroups: vi.fn(() => []),
    writeGroupsSnapshot: vi.fn(),
    clearSession: vi.fn(),
    delegateToChild: vi.fn(async () => {}),
    delegateToParent: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  _initTestDatabase();
});

describe('get_grants', () => {
  it('returns empty rules when no overrides set', async () => {
    const r = await getGrants.handler({ folder: 'root/child' }, makeCtx());
    expect(r).toEqual({ rules: [] });
  });

  it('returns stored rules after set', async () => {
    const rules = ['send_reply', '!post'];
    await setGrants.handler({ folder: 'root/child', rules }, makeCtx(0));
    const r = await getGrants.handler({ folder: 'root/child' }, makeCtx());
    expect(r).toEqual({ rules });
  });
});

describe('set_grants', () => {
  it('stores rules and returns ok', async () => {
    const rules = ['*'];
    const r = await setGrants.handler(
      { folder: 'root/child', rules },
      makeCtx(0),
    );
    expect(r).toEqual({ ok: true });
    expect(getGrantOverrides('root/child')).toEqual(rules);
  });

  it('rejects non-tier-0 callers', async () => {
    await expect(
      setGrants.handler({ folder: 'root/child', rules: ['*'] }, makeCtx(1)),
    ).rejects.toThrow('unauthorized');
  });

  it('stores complex rules', async () => {
    const rules = ['send_message(jid=tg:*)', '!post', 'send_reply'];
    await setGrants.handler({ folder: 'root/a', rules }, makeCtx(0));
    expect(getGrantOverrides('root/a')).toEqual(rules);
  });

  it('overwrites previous overrides', async () => {
    await setGrants.handler({ folder: 'root/x', rules: ['*'] }, makeCtx(0));
    await setGrants.handler(
      { folder: 'root/x', rules: ['send_reply'] },
      makeCtx(0),
    );
    expect(getGrantOverrides('root/x')).toEqual(['send_reply']);
  });
});

describe('migration: grants table exists', () => {
  it('createTestDatabase succeeds with grants table', async () => {
    // _initTestDatabase already ran; just verify we can use grants functions
    const rules = ['send_reply'];
    await setGrants.handler({ folder: 'root/mig-test', rules }, makeCtx(0));
    expect(getGrantOverrides('root/mig-test')).toEqual(rules);
  });
});
