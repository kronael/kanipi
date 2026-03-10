import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getAllChats, storeChatMetadata } from './db.js';
import { getAvailableGroups, _setRegisteredGroups } from './index.js';
import {
  isAuthorizedRoutingTarget,
  resolveRoutingTarget,
  spawnFolderName,
  platformFromJid,
} from './router.js';
import type { NewMessage, RoutingRule } from './types.js';

beforeEach(() => {
  _initTestDatabase();
  _setRegisteredGroups({});
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

    _setRegisteredGroups({
      'reg@g.us': {
        name: 'Registered',
        folder: 'registered',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

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

// --- resolveRoutingTarget ---

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

describe('resolveRoutingTarget — precedence', () => {
  it('command beats keyword for same message', () => {
    const rules: RoutingRule[] = [
      { type: 'keyword', keyword: 'fix', target: 'main/general' },
      { type: 'command', trigger: '/code', target: 'main/code' },
    ];
    expect(resolveRoutingTarget(msg('/code fix the bug'), rules)).toBe(
      'main/code',
    );
  });

  it('command beats default', () => {
    const rules: RoutingRule[] = [
      { type: 'default', target: 'main/general' },
      { type: 'command', trigger: '/code', target: 'main/code' },
    ];
    expect(resolveRoutingTarget(msg('/code hello'), rules)).toBe('main/code');
  });

  it('pattern beats keyword for same message', () => {
    const rules: RoutingRule[] = [
      { type: 'keyword', keyword: 'deploy', target: 'main/general' },
      { type: 'pattern', pattern: '^deploy', target: 'main/deploy' },
    ];
    expect(resolveRoutingTarget(msg('deploy the app'), rules)).toBe(
      'main/deploy',
    );
  });

  it('keyword beats sender for same message', () => {
    const rules: RoutingRule[] = [
      { type: 'sender', pattern: 'alice', target: 'team/alice' },
      { type: 'keyword', keyword: 'urgent', target: 'main/ops' },
    ];
    const m = msg('urgent: system down', 'alice@s.whatsapp.net', 'alice');
    expect(resolveRoutingTarget(m, rules)).toBe('main/ops');
  });

  it('sender beats default', () => {
    const rules: RoutingRule[] = [
      { type: 'default', target: 'team/shared' },
      { type: 'sender', pattern: 'alice', target: 'team/alice' },
    ];
    expect(
      resolveRoutingTarget(
        msg('hello', 'alice@s.whatsapp.net', 'alice'),
        rules,
      ),
    ).toBe('team/alice');
  });

  it('default catch-all when no other rule matches', () => {
    const rules: RoutingRule[] = [
      { type: 'command', trigger: '/code', target: 'main/code' },
      { type: 'default', target: 'main/general' },
    ];
    expect(resolveRoutingTarget(msg('plain message'), rules)).toBe(
      'main/general',
    );
  });

  it('returns null when no rules match and no default', () => {
    const rules: RoutingRule[] = [
      { type: 'command', trigger: '/code', target: 'main/code' },
    ];
    expect(resolveRoutingTarget(msg('plain message'), rules)).toBeNull();
  });

  it('invalid regex in pattern rule is skipped', () => {
    const rules: RoutingRule[] = [
      { type: 'pattern', pattern: '[invalid(', target: 'main/code' },
      { type: 'default', target: 'main/general' },
    ];
    expect(resolveRoutingTarget(msg('anything'), rules)).toBe('main/general');
  });

  it('invalid regex in sender rule is skipped', () => {
    const rules: RoutingRule[] = [
      { type: 'sender', pattern: '(bad[regex', target: 'team/alice' },
      { type: 'default', target: 'team/shared' },
    ];
    expect(
      resolveRoutingTarget(msg('hi', 'alice@s.whatsapp.net', 'alice'), rules),
    ).toBe('team/shared');
  });

  it('command matches exact trigger (no trailing space)', () => {
    const rules: RoutingRule[] = [
      { type: 'command', trigger: '/help', target: 'main/help' },
    ];
    expect(resolveRoutingTarget(msg('/help'), rules)).toBe('main/help');
  });

  it('command matches trigger followed by space and text', () => {
    const rules: RoutingRule[] = [
      { type: 'command', trigger: '/code', target: 'main/code' },
    ];
    expect(resolveRoutingTarget(msg('/code do something'), rules)).toBe(
      'main/code',
    );
  });

  it('command does not match trigger that is just a prefix (no space)', () => {
    const rules: RoutingRule[] = [
      { type: 'command', trigger: '/code', target: 'main/code' },
    ];
    // '/codebase' should not match trigger '/code'
    expect(resolveRoutingTarget(msg('/codebase review'), rules)).toBeNull();
  });

  it('first matching rule within same tier wins', () => {
    const rules: RoutingRule[] = [
      { type: 'keyword', keyword: 'deploy', target: 'main/deploy' },
      { type: 'keyword', keyword: 'deploy', target: 'main/ops' },
    ];
    expect(resolveRoutingTarget(msg('deploy now'), rules)).toBe('main/deploy');
  });

  it('returns null for empty rules array', () => {
    expect(resolveRoutingTarget(msg('hello'), [])).toBeNull();
  });
});

describe('resolveRoutingTarget — sender routing', () => {
  it('matches sender_name when present', () => {
    const rules: RoutingRule[] = [
      { type: 'sender', pattern: '^alice$', target: 'team/alice' },
    ];
    expect(
      resolveRoutingTarget(
        msg('hello', 'alice@s.whatsapp.net', 'alice'),
        rules,
      ),
    ).toBe('team/alice');
  });

  it('falls back to sender JID when sender_name is absent', () => {
    const rules: RoutingRule[] = [
      {
        type: 'sender',
        pattern: 'alice@s.whatsapp.net',
        target: 'team/alice',
      },
    ];
    expect(
      resolveRoutingTarget(msg('hello', 'alice@s.whatsapp.net'), rules),
    ).toBe('team/alice');
  });

  it('routes different senders to different children', () => {
    const rules: RoutingRule[] = [
      { type: 'sender', pattern: 'alice', target: 'team/alice' },
      { type: 'sender', pattern: 'bob', target: 'team/bob' },
      { type: 'default', target: 'team/shared' },
    ];
    expect(
      resolveRoutingTarget(msg('hi', 'alice@s.whatsapp.net', 'alice'), rules),
    ).toBe('team/alice');
    expect(
      resolveRoutingTarget(msg('hi', 'bob@s.whatsapp.net', 'bob'), rules),
    ).toBe('team/bob');
    expect(
      resolveRoutingTarget(
        msg('hi', 'charlie@s.whatsapp.net', 'charlie'),
        rules,
      ),
    ).toBe('team/shared');
  });

  it('sender pattern is a regex (partial match)', () => {
    const rules: RoutingRule[] = [
      { type: 'sender', pattern: 'alice', target: 'team/alice' },
    ];
    // 'alice_work' also matches pattern 'alice'
    expect(
      resolveRoutingTarget(
        msg('hello', 'x@s.whatsapp.net', 'alice_work'),
        rules,
      ),
    ).toBe('team/alice');
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
});
