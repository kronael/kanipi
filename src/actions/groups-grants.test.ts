/**
 * Tests for delegate_group grants parameter.
 *
 * Uses real in-memory SQLite to verify setGrantOverrides is called
 * correctly when grants are passed to delegate_group.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { _initTestDatabase } from '../db.js';
import { getGrantOverrides } from '../grants.js';
import { delegateGroup } from './groups.js';
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
  registerCommand: vi.fn(),
  findCommand: vi.fn(),
}));

vi.mock('../router.js', () => ({
  isAuthorizedRoutingTarget: vi.fn(() => true),
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
    ...opts,
  };
}

beforeEach(() => {
  _initTestDatabase();
});

describe('delegate_group with grants param', () => {
  it('sets grant overrides when grants provided', async () => {
    const ctx = makeCtx('root');
    const grants = ['send_reply', '!post'];
    await delegateGroup.handler(
      {
        group: 'root/child',
        prompt: 'do work',
        chatJid: 'tg/-100',
        grants,
      },
      ctx,
    );

    const stored = getGrantOverrides('root/child');
    expect(stored).toEqual(grants);
  });

  it('does not set overrides when grants not provided', async () => {
    const ctx = makeCtx('root');
    await delegateGroup.handler(
      { group: 'root/child', prompt: 'do work', chatJid: 'tg/-100' },
      ctx,
    );

    const stored = getGrantOverrides('root/child');
    expect(stored).toBeNull();
  });

  it('does not set overrides when grants is empty array', async () => {
    const ctx = makeCtx('root');
    await delegateGroup.handler(
      {
        group: 'root/child',
        prompt: 'do work',
        chatJid: 'tg/-100',
        grants: [],
      },
      ctx,
    );

    const stored = getGrantOverrides('root/child');
    expect(stored).toBeNull();
  });

  it('overwrites previous overrides', async () => {
    const ctx = makeCtx('root');
    await delegateGroup.handler(
      {
        group: 'root/child',
        prompt: 'first',
        chatJid: 'tg/-100',
        grants: ['*'],
      },
      ctx,
    );
    expect(getGrantOverrides('root/child')).toEqual(['*']);

    await delegateGroup.handler(
      {
        group: 'root/child',
        prompt: 'second',
        chatJid: 'tg/-100',
        grants: ['send_reply'],
      },
      ctx,
    );
    expect(getGrantOverrides('root/child')).toEqual(['send_reply']);
  });

  it('complex grant rules stored via delegation', async () => {
    const ctx = makeCtx('root');
    const grants = [
      '!post',
      '!react',
      'send_message(jid=telegram:*)',
      'send_reply',
    ];
    await delegateGroup.handler(
      {
        group: 'root/child',
        prompt: 'restricted work',
        chatJid: 'tg/-100',
        grants,
      },
      ctx,
    );

    expect(getGrantOverrides('root/child')).toEqual(grants);
  });

  it('tier 3 cannot delegate (with or without grants)', async () => {
    const ctx = makeCtx('root/a/b/c');
    await expect(
      delegateGroup.handler(
        {
          group: 'root/a/b/c/d',
          prompt: 'x',
          chatJid: 'tg/-100',
          grants: ['send_reply'],
        },
        ctx,
      ),
    ).rejects.toThrow('unauthorized');
  });
});
