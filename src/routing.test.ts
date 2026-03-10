import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, storeChatMetadata } from './db.js';
import { getAvailableGroups, _setGroups } from './index.js';
import {
  isAuthorizedRoutingTarget,
  resolveRoute,
  spawnFolderName,
  platformFromJid,
} from './router.js';
import type { NewMessage, Route } from './types.js';

beforeEach(() => {
  _initTestDatabase();
  _setGroups({}, {});
});

// --- spawnFolderName ---

describe('spawnFolderName', () => {
  it('replaces non-alphanumeric with underscore', () => {
    expect(spawnFolderName('tg:-100123456')).toBe('tg_100123456');
  });

  it('collapses consecutive underscores', () => {
    expect(spawnFolderName('a:b::c')).toBe('a_b_c');
  });

  it('trims leading/trailing underscores', () => {
    expect(spawnFolderName(':abc:')).toBe('abc');
  });

  it('enforces 63-char length limit', () => {
    const long = 'a'.repeat(100);
    expect(spawnFolderName(long).length).toBe(63);
  });

  it('handles mastodon JID', () => {
    expect(spawnFolderName('mastodon:instance.social:12345')).toBe(
      'mastodon_instance_social_12345',
    );
  });

  it('empty JID returns empty string', () => {
    expect(spawnFolderName('')).toBe('');
  });

  it('all-special-chars returns empty string', () => {
    expect(spawnFolderName('::..--')).toBe('');
  });
});

// --- platformFromJid ---

describe('platformFromJid', () => {
  it('extracts prefix before first colon', () => {
    expect(platformFromJid('twitter:123')).toBe('twitter');
  });

  it('multiple colons returns first segment', () => {
    expect(platformFromJid('mastodon:instance:id')).toBe('mastodon');
  });

  it('no colon returns full string', () => {
    expect(platformFromJid('telegram')).toBe('telegram');
  });

  it('empty string returns empty string', () => {
    expect(platformFromJid('')).toBe('');
  });
});

// --- JID ownership patterns ---

describe('JID ownership patterns', () => {
  // These test the patterns that will become ownsJid() on the Channel interface

  it('WhatsApp group JID: ends with @g.us', () => {
    const jid = '12345678@g.us';
    expect(jid.endsWith('@g.us')).toBe(true);
  });

  it('WhatsApp DM JID: ends with @s.whatsapp.net', () => {
    const jid = '12345678@s.whatsapp.net';
    expect(jid.endsWith('@s.whatsapp.net')).toBe(true);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only groups, excludes DMs', () => {
    storeChatMetadata(
      'group1@g.us',
      '2024-01-01T00:00:01.000Z',
      'Group 1',
      'whatsapp',
      true,
    );
    storeChatMetadata(
      'user@s.whatsapp.net',
      '2024-01-01T00:00:02.000Z',
      'User DM',
      'whatsapp',
      false,
    );
    storeChatMetadata(
      'group2@g.us',
      '2024-01-01T00:00:03.000Z',
      'Group 2',
      'whatsapp',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.jid)).toContain('group1@g.us');
    expect(groups.map((g) => g.jid)).toContain('group2@g.us');
    expect(groups.map((g) => g.jid)).not.toContain('user@s.whatsapp.net');
  });

  it('excludes __group_sync__ sentinel', () => {
    storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    storeChatMetadata(
      'group@g.us',
      '2024-01-01T00:00:01.000Z',
      'Group',
      'whatsapp',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group@g.us');
  });

  it('marks registered groups correctly', () => {
    storeChatMetadata(
      'reg@g.us',
      '2024-01-01T00:00:01.000Z',
      'Registered',
      'whatsapp',
      true,
    );
    storeChatMetadata(
      'unreg@g.us',
      '2024-01-01T00:00:02.000Z',
      'Unregistered',
      'whatsapp',
      true,
    );

    _setGroups(
      {
        registered: {
          name: 'Registered',
          folder: 'registered',
          added_at: '2024-01-01T00:00:00.000Z',
        },
      },
      { 'reg@g.us': 'registered' },
    );

    const groups = getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'reg@g.us');
    const unreg = groups.find((g) => g.jid === 'unreg@g.us');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', () => {
    storeChatMetadata(
      'old@g.us',
      '2024-01-01T00:00:01.000Z',
      'Old',
      'whatsapp',
      true,
    );
    storeChatMetadata(
      'new@g.us',
      '2024-01-01T00:00:05.000Z',
      'New',
      'whatsapp',
      true,
    );
    storeChatMetadata(
      'mid@g.us',
      '2024-01-01T00:00:03.000Z',
      'Mid',
      'whatsapp',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('new@g.us');
    expect(groups[1].jid).toBe('mid@g.us');
    expect(groups[2].jid).toBe('old@g.us');
  });

  it('excludes non-group chats regardless of JID format', () => {
    // Unknown JID format stored without is_group should not appear
    storeChatMetadata(
      'unknown-format-123',
      '2024-01-01T00:00:01.000Z',
      'Unknown',
    );
    // Explicitly non-group with unusual JID
    storeChatMetadata(
      'custom:abc',
      '2024-01-01T00:00:02.000Z',
      'Custom DM',
      'custom',
      false,
    );
    // A real group for contrast
    storeChatMetadata(
      'group@g.us',
      '2024-01-01T00:00:03.000Z',
      'Group',
      'whatsapp',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group@g.us');
  });

  it('returns empty array when no chats exist', () => {
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(0);
  });
});

// --- isAuthorizedRoutingTarget ---

describe('isAuthorizedRoutingTarget', () => {
  it('allows direct parent→child', () => {
    expect(isAuthorizedRoutingTarget('root', 'root/code')).toBe(true);
  });

  it('allows non-root parent→child', () => {
    expect(isAuthorizedRoutingTarget('main/code', 'main/code/py')).toBe(true);
  });

  it('allows non-direct descendants (grandchildren)', () => {
    expect(isAuthorizedRoutingTarget('root', 'root/code/py')).toBe(true);
    expect(isAuthorizedRoutingTarget('root', 'root/code/py/lint')).toBe(true);
  });

  it('blocks sibling routing', () => {
    expect(isAuthorizedRoutingTarget('main/code', 'main/ops')).toBe(false);
  });

  it('root world allows cross-world delegation', () => {
    expect(isAuthorizedRoutingTarget('root', 'team/alice')).toBe(true);
    expect(isAuthorizedRoutingTarget('root', 'atlas/support')).toBe(true);
  });

  it('root subgroup allows cross-world delegation', () => {
    expect(isAuthorizedRoutingTarget('root/ops', 'atlas/support')).toBe(true);
    expect(isAuthorizedRoutingTarget('root/code', 'team/alice')).toBe(true);
  });

  it('root world allows ancestor and same-folder targets', () => {
    // Self-targeting is blocked at the call site (index.ts), not here
    expect(isAuthorizedRoutingTarget('root', 'root')).toBe(true);
    expect(isAuthorizedRoutingTarget('root/code', 'root')).toBe(true);
  });

  it('blocks non-root cross-world routing', () => {
    expect(isAuthorizedRoutingTarget('atlas', 'team/alice')).toBe(false);
    expect(isAuthorizedRoutingTarget('main/code', 'team/alice')).toBe(false);
  });

  it('blocks non-root ancestor routing', () => {
    expect(isAuthorizedRoutingTarget('atlas/support', 'atlas')).toBe(false);
  });

  it('blocks non-root same folder', () => {
    expect(isAuthorizedRoutingTarget('atlas', 'atlas')).toBe(false);
  });

  it('allows non-root to delegate to direct child', () => {
    expect(isAuthorizedRoutingTarget('atlas', 'atlas/child')).toBe(true);
  });

  it('allows non-root to delegate to deeper descendant', () => {
    expect(isAuthorizedRoutingTarget('atlas', 'atlas/child/grandchild')).toBe(
      true,
    );
  });
});

// --- resolveRoute (flat routing table) ---

function msg(
  content: string,
  sender = 'user@s.whatsapp.net',
  sender_name?: string,
): NewMessage {
  return {
    id: '1',
    chat_jid: 'group@g.us',
    sender,
    sender_name,
    content,
    timestamp: new Date().toISOString(),
  };
}

function mkMsg(content: string): NewMessage {
  return {
    id: '1',
    chat_jid: 'test:1',
    sender: 'user',
    content,
    timestamp: new Date().toISOString(),
  };
}

describe('resolveRoute — flat routing table', () => {
  it('command match returns target', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'command',
        match: '@root',
        target: 'root',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'atlas',
      },
    ];
    expect(resolveRoute(mkMsg('@root help'), routes)).toBe('root');
  });

  it('default fallback when no command match', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'command',
        match: '@root',
        target: 'root',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'atlas',
      },
    ];
    expect(resolveRoute(mkMsg('hello'), routes)).toBe('atlas');
  });

  it('respects seq order — first match wins', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'keyword',
        match: 'urgent',
        target: 'ops',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'keyword',
        match: 'urgent',
        target: 'general',
      },
    ];
    expect(resolveRoute(mkMsg('urgent issue'), routes)).toBe('ops');
  });

  it('returns null when no routes match', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'command',
        match: '/code',
        target: 'code',
      },
    ];
    expect(resolveRoute(mkMsg('hello'), routes)).toBeNull();
  });

  it('pattern type uses regex', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'pattern',
        match: '^deploy',
        target: 'deploy',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(resolveRoute(mkMsg('deploy the app'), routes)).toBe('deploy');
    expect(resolveRoute(mkMsg('please deploy'), routes)).toBe('general');
  });

  it('sender type matches sender_name', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'sender',
        match: 'alice',
        target: 'team/alice',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(
      resolveRoute(msg('hi', 'alice@s.whatsapp.net', 'alice'), routes),
    ).toBe('team/alice');
    expect(resolveRoute(msg('hi', 'bob@s.whatsapp.net', 'bob'), routes)).toBe(
      'general',
    );
  });

  it('verb type matches message verb', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'verb',
        match: 'join',
        target: 'welcome',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    const joinMsg: NewMessage = { ...mkMsg(''), verb: 'join' };
    expect(resolveRoute(joinMsg, routes)).toBe('welcome');
  });

  it('empty routes returns null', () => {
    expect(resolveRoute(mkMsg('hello'), [])).toBeNull();
  });

  it('command type does not match different command', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'command',
        match: '@code',
        target: 'code',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(resolveRoute(mkMsg('@root help'), routes)).toBe('general');
  });

  it('keyword type matches case-insensitively', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'keyword',
        match: 'URGENT',
        target: 'ops',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(resolveRoute(mkMsg('this is urgent'), routes)).toBe('ops');
    expect(resolveRoute(mkMsg('this is URGENT'), routes)).toBe('ops');
    expect(resolveRoute(mkMsg('this is Urgent'), routes)).toBe('ops');
  });

  it('pattern type skips invalid regex', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'pattern',
        match: '[invalid(regex',
        target: 'invalid',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(resolveRoute(mkMsg('test'), routes)).toBe('general');
  });

  it('pattern type skips regex longer than 200 chars', () => {
    const longRegex = 'a'.repeat(201);
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'pattern',
        match: longRegex,
        target: 'long',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(resolveRoute(mkMsg('a'), routes)).toBe('general');
  });

  it('sender type falls back to sender JID when sender_name absent', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'sender',
        match: 'alice@s.whatsapp.net',
        target: 'team/alice',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(
      resolveRoute(msg('hi', 'alice@s.whatsapp.net', undefined), routes),
    ).toBe('team/alice');
  });

  it('sender type skips invalid regex', () => {
    const routes: Route[] = [
      {
        id: 1,
        jid: 'tg:1',
        seq: 0,
        type: 'sender',
        match: '[invalid(regex',
        target: 'invalid',
      },
      {
        id: 2,
        jid: 'tg:1',
        seq: 1,
        type: 'default',
        match: null,
        target: 'general',
      },
    ];
    expect(
      resolveRoute(msg('hi', 'alice@s.whatsapp.net', 'alice'), routes),
    ).toBe('general');
  });
});
