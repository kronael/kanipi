import { describe, it, expect, vi } from 'vitest';

import {
  parseRule,
  checkAction,
  matchingRules,
  narrowRules,
  deriveRules,
} from './grants.js';

vi.mock('./db.js', () => ({
  getAllRoutes: vi.fn(() => []),
  getDatabase: vi.fn(),
}));

vi.mock('./config.js', () => ({
  permissionTier: (folder: string) =>
    folder.includes('/') ? Math.min(folder.split('/').length, 3) : 0,
}));

vi.mock('./permissions.js', () => ({
  worldOf: (folder: string) => folder.split('/')[0],
}));

// ── parseRule ──────────────────────────────────────────────────────────────────

describe('parseRule', () => {
  it('simple action', () => {
    const r = parseRule('post');
    expect(r.deny).toBe(false);
    expect(r.action).toBe('post');
    expect(r.params.size).toBe(0);
  });

  it('deny action', () => {
    const r = parseRule('!post');
    expect(r.deny).toBe(true);
    expect(r.action).toBe('post');
  });

  it('action with params', () => {
    const r = parseRule('post(jid=twitter:*)');
    expect(r.deny).toBe(false);
    expect(r.action).toBe('post');
    expect(r.params.get('jid')).toBe('twitter:*');
  });

  it('multiple params', () => {
    const r = parseRule('post(jid=twitter:*, target=foo)');
    expect(r.params.get('jid')).toBe('twitter:*');
    expect(r.params.get('target')).toBe('foo');
  });

  it('empty parens = any params', () => {
    const r = parseRule('post()');
    expect(r.action).toBe('post');
    expect(r.params.size).toBe(0);
  });

  it('wildcard action', () => {
    const r = parseRule('*');
    expect(r.action).toBe('*');
    expect(r.deny).toBe(false);
  });

  it('negated param', () => {
    const r = parseRule('post(!media)');
    expect(r.params.get('!media')).toBe('');
  });

  it('deny wildcard', () => {
    const r = parseRule('!*');
    expect(r.deny).toBe(true);
    expect(r.action).toBe('*');
  });

  it('whitespace trimming', () => {
    const r = parseRule('  !post  ');
    expect(r.deny).toBe(true);
    expect(r.action).toBe('post');
  });

  it('param with spaces around =', () => {
    const r = parseRule('post(jid = twitter:*)');
    expect(r.params.get('jid')).toBe('twitter:*');
  });

  it('param with spaces around comma', () => {
    const r = parseRule('post(jid=a ,  target=b)');
    expect(r.params.get('jid')).toBe('a');
    expect(r.params.get('target')).toBe('b');
  });

  it('glob action name: send_*', () => {
    const r = parseRule('send_*');
    expect(r.action).toBe('send_*');
    expect(r.deny).toBe(false);
    expect(r.params.size).toBe(0);
  });

  it('deny glob action', () => {
    const r = parseRule('!send_*');
    expect(r.deny).toBe(true);
    expect(r.action).toBe('send_*');
  });

  it('param with glob in value', () => {
    const r = parseRule('send_message(jid=telegram:*)');
    expect(r.params.get('jid')).toBe('telegram:*');
  });

  it('multiple negated params', () => {
    const r = parseRule('post(!media, !nsfw)');
    expect(r.params.get('!media')).toBe('');
    expect(r.params.get('!nsfw')).toBe('');
  });

  it('mixed params and negated params', () => {
    const r = parseRule('post(jid=twitter:*, !media)');
    expect(r.params.get('jid')).toBe('twitter:*');
    expect(r.params.get('!media')).toBe('');
  });

  it('unclosed paren still parses params', () => {
    const r = parseRule('post(jid=x');
    expect(r.action).toBe('post');
    expect(r.params.get('jid')).toBe('x');
  });

  it('empty string', () => {
    const r = parseRule('');
    expect(r.action).toBe('');
    expect(r.deny).toBe(false);
    expect(r.params.size).toBe(0);
  });

  it('deny with params', () => {
    const r = parseRule('!post(jid=twitter:*)');
    expect(r.deny).toBe(true);
    expect(r.action).toBe('post');
    expect(r.params.get('jid')).toBe('twitter:*');
  });
});

// ── checkAction ────────────────────────────────────────────────────────────────

describe('checkAction', () => {
  describe('basic allow/deny', () => {
    it('no rules = deny', () => {
      expect(checkAction([], 'post', {})).toBe(false);
    });

    it('wildcard allows everything', () => {
      expect(checkAction(['*'], 'post', {})).toBe(true);
      expect(checkAction(['*'], 'send_message', { jid: 'tg:123' })).toBe(true);
    });

    it('simple allow', () => {
      expect(checkAction(['post'], 'post', {})).toBe(true);
      expect(checkAction(['post'], 'reply', {})).toBe(false);
    });
  });

  describe('last-match-wins semantics', () => {
    it('deny overrides allow', () => {
      expect(checkAction(['post', '!post'], 'post', {})).toBe(false);
    });

    it('allow after deny re-allows', () => {
      expect(checkAction(['!post', 'post'], 'post', {})).toBe(true);
    });

    it('multiple alternating: last wins', () => {
      expect(checkAction(['post', '!post', 'post', '!post'], 'post', {})).toBe(
        false,
      );
      expect(checkAction(['!post', 'post', '!post', 'post'], 'post', {})).toBe(
        true,
      );
    });

    it('wildcard then deny specific', () => {
      const rules = ['*', '!post'];
      expect(checkAction(rules, 'post', {})).toBe(false);
      expect(checkAction(rules, 'reply', {})).toBe(true);
      expect(checkAction(rules, 'send_message', {})).toBe(true);
    });

    it('wildcard then deny then re-allow specific', () => {
      const rules = ['*', '!post', 'post(jid=discord:*)'];
      expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(true);
      expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
      expect(checkAction(rules, 'post', {})).toBe(false);
    });
  });

  describe('param constraints', () => {
    it('param constraint matches', () => {
      expect(
        checkAction(['post(jid=twitter:*)'], 'post', { jid: 'twitter:123' }),
      ).toBe(true);
    });

    it('param constraint rejects non-matching', () => {
      expect(
        checkAction(['post(jid=twitter:*)'], 'post', { jid: 'discord:abc' }),
      ).toBe(false);
    });

    it('unmentioned params are allowed', () => {
      expect(
        checkAction(['post(jid=twitter:*)'], 'post', {
          jid: 'twitter:123',
          content: 'hello',
        }),
      ).toBe(true);
    });

    it('param constraint requires param to be present', () => {
      expect(checkAction(['post(jid=twitter:*)'], 'post', {})).toBe(false);
    });

    it('exact param value match', () => {
      expect(
        checkAction(['send_message(jid=telegram:123)'], 'send_message', {
          jid: 'telegram:123',
        }),
      ).toBe(true);
      expect(
        checkAction(['send_message(jid=telegram:123)'], 'send_message', {
          jid: 'telegram:999',
        }),
      ).toBe(false);
    });

    it('multiple param constraints: all must match', () => {
      const rules = ['post(jid=twitter:*, target=foo)'];
      expect(
        checkAction(rules, 'post', { jid: 'twitter:1', target: 'foo' }),
      ).toBe(true);
      expect(
        checkAction(rules, 'post', { jid: 'twitter:1', target: 'bar' }),
      ).toBe(false);
      expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
    });

    it('negated param (!param): param must NOT be present', () => {
      const rules = ['post(!media)'];
      // Rule says !media — param named "!media" with value ""
      // In ruleMatches: k="!media", v="", k.startsWith("!") → realKey="media"
      // If "media" is in params → return false (no match for this rule)
      expect(checkAction(rules, 'post', {})).toBe(true);
      expect(checkAction(rules, 'post', { media: 'photo.jpg' })).toBe(false);
    });

    it('deny with param constraint', () => {
      const rules = ['*', '!post(jid=twitter:*)'];
      expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
      expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(true);
      expect(checkAction(rules, 'reply', { jid: 'twitter:1' })).toBe(true);
    });

    it('rule with param on action that has no params at all', () => {
      // Rule requires jid param but action is called with no params
      expect(
        checkAction(['send_message(jid=telegram:*)'], 'send_message', {}),
      ).toBe(false);
    });
  });

  describe('glob matching in action names', () => {
    it('wildcard in action name', () => {
      expect(checkAction(['send_*'], 'send_message', {})).toBe(true);
      expect(checkAction(['send_*'], 'send_reply', {})).toBe(true);
      expect(checkAction(['send_*'], 'send_file', {})).toBe(true);
      expect(checkAction(['send_*'], 'post', {})).toBe(false);
    });

    it('glob does not match across underscores', () => {
      // * matches [a-zA-Z0-9_]* so it DOES match underscores
      expect(checkAction(['s*'], 'send_message', {})).toBe(true);
    });

    it('deny glob action', () => {
      const rules = ['*', '!send_*'];
      expect(checkAction(rules, 'send_message', {})).toBe(false);
      expect(checkAction(rules, 'send_reply', {})).toBe(false);
      expect(checkAction(rules, 'post', {})).toBe(true);
    });

    it('glob * matches empty string', () => {
      expect(checkAction(['send*'], 'send', {})).toBe(true);
    });

    it('glob in middle of action name', () => {
      expect(checkAction(['send_*_message'], 'send_big_message', {})).toBe(
        true,
      );
      expect(checkAction(['send_*_message'], 'send_message', {})).toBe(false);
    });
  });

  describe('param glob matching', () => {
    it('glob in param value', () => {
      expect(
        checkAction(['post(jid=twitter:*)'], 'post', {
          jid: 'twitter:abc123',
        }),
      ).toBe(true);
    });

    it('param glob * matches empty suffix', () => {
      expect(
        checkAction(['post(jid=twitter:*)'], 'post', { jid: 'twitter:' }),
      ).toBe(true);
    });
  });

  describe('complex scenarios', () => {
    it('tier 3 defaults: send_reply only', () => {
      const rules = ['send_reply'];
      expect(checkAction(rules, 'send_reply', {})).toBe(true);
      expect(checkAction(rules, 'send_message', {})).toBe(false);
      expect(checkAction(rules, 'post', {})).toBe(false);
      expect(checkAction(rules, 'delegate_group', {})).toBe(false);
    });

    it('allow all then deny specific platform', () => {
      const rules = ['*', '!post(jid=twitter:*)'];
      expect(checkAction(rules, 'reply', { jid: 'twitter:1' })).toBe(true);
      expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(true);
      expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
    });

    it('narrowed delegation: parent allow all, child deny social', () => {
      const rules = ['*', '!post', '!react', '!follow'];
      expect(checkAction(rules, 'send_message', { jid: 'tg:1' })).toBe(true);
      expect(checkAction(rules, 'send_reply', {})).toBe(true);
      expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
      expect(checkAction(rules, 'react', { jid: 'twitter:1' })).toBe(false);
      expect(checkAction(rules, 'follow', { jid: 'twitter:1' })).toBe(false);
    });

    it('tier 2 style: messaging + social on specific platforms', () => {
      const rules = [
        'send_reply',
        'send_message(jid=telegram:*)',
        'send_file(jid=telegram:*)',
        'post(jid=telegram:*)',
        'react(jid=telegram:*)',
      ];
      expect(checkAction(rules, 'send_reply', {})).toBe(true);
      expect(checkAction(rules, 'send_message', { jid: 'telegram:123' })).toBe(
        true,
      );
      expect(checkAction(rules, 'send_message', { jid: 'discord:123' })).toBe(
        false,
      );
      expect(checkAction(rules, 'post', { jid: 'telegram:1' })).toBe(true);
      expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(false);
      expect(checkAction(rules, 'delegate_group', {})).toBe(false);
    });

    it('many rules: last matching rule determines outcome', () => {
      const rules = [
        'post',
        '!post',
        'post(jid=twitter:*)',
        '!post(jid=twitter:nsfw)',
      ];
      // post with jid=twitter:safe → last match is post(jid=twitter:*) = allow
      // wait, the deny !post(jid=twitter:nsfw) doesn't match twitter:safe
      expect(checkAction(rules, 'post', { jid: 'twitter:safe' })).toBe(true);
      expect(checkAction(rules, 'post', { jid: 'twitter:nsfw' })).toBe(false);
      expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(false);
    });
  });
});

// ── matchingRules ──────────────────────────────────────────────────────────────

describe('matchingRules', () => {
  it('returns null for denied action', () => {
    expect(matchingRules(['!post'], 'post')).toBeNull();
  });

  it('returns null for unmentioned action', () => {
    expect(matchingRules(['reply'], 'post')).toBeNull();
  });

  it('returns matching allow rules', () => {
    const rules = ['post(jid=twitter:*)', 'post(jid=discord:*)'];
    const result = matchingRules(rules, 'post');
    expect(result).toEqual(rules);
  });

  it('returns null when last match is deny', () => {
    const rules = ['post(jid=twitter:*)', '!post'];
    expect(matchingRules(rules, 'post')).toBeNull();
  });

  it('wildcard matches action', () => {
    const result = matchingRules(['*'], 'post');
    expect(result).toEqual(['*']);
  });

  it('collects only allow rules for action', () => {
    const rules = ['*', '!post', 'post(jid=discord:*)'];
    const result = matchingRules(rules, 'post');
    expect(result).toEqual(['*', 'post(jid=discord:*)']);
  });

  it('glob action in rules matches', () => {
    const result = matchingRules(['send_*'], 'send_message');
    expect(result).toEqual(['send_*']);
  });

  it('deny glob excludes action', () => {
    expect(matchingRules(['*', '!send_*'], 'send_message')).toBeNull();
  });

  it('re-allow after deny returns only the allow rules', () => {
    const rules = ['*', '!post', 'post(jid=twitter:*)'];
    const result = matchingRules(rules, 'post');
    // Only non-deny rules that matched: '*' and 'post(jid=twitter:*)'
    expect(result).toEqual(['*', 'post(jid=twitter:*)']);
  });

  it('multiple allow rules all collected', () => {
    const rules = [
      'post(jid=twitter:*)',
      'post(jid=discord:*)',
      'post(jid=telegram:*)',
    ];
    expect(matchingRules(rules, 'post')).toEqual(rules);
  });

  it('unrelated actions do not interfere', () => {
    const rules = ['reply', 'send_message', 'post'];
    const result = matchingRules(rules, 'post');
    expect(result).toEqual(['post']);
  });
});

// ── narrowRules ────────────────────────────────────────────────────────────────

describe('narrowRules', () => {
  it('appends child rules after parent', () => {
    const parent = ['*'];
    const child = ['!post'];
    const result = narrowRules(parent, child);
    expect(result).toEqual(['*', '!post']);
  });

  it('child deny overrides parent allow', () => {
    const parent = ['post', 'reply'];
    const child = ['!post'];
    const result = narrowRules(parent, child);
    expect(checkAction(result, 'post', {})).toBe(false);
    expect(checkAction(result, 'reply', {})).toBe(true);
  });

  it('child can restrict platform scope', () => {
    const parent = ['*'];
    const child = ['!post', 'post(jid=discord:*)'];
    const result = narrowRules(parent, child);
    expect(checkAction(result, 'post', { jid: 'discord:1' })).toBe(true);
    expect(checkAction(result, 'post', { jid: 'twitter:1' })).toBe(false);
  });

  it('empty child preserves parent', () => {
    const parent = ['*'];
    expect(narrowRules(parent, [])).toEqual(['*']);
  });

  it('empty parent with child rules', () => {
    const child = ['post'];
    const result = narrowRules([], child);
    expect(checkAction(result, 'post', {})).toBe(true);
  });

  it('multi-level narrowing: grandparent → parent → child', () => {
    const gp = ['*'];
    const p = ['!delete_post', '!ban'];
    const c = ['!post'];
    const level1 = narrowRules(gp, p);
    const level2 = narrowRules(level1, c);
    expect(checkAction(level2, 'send_reply', {})).toBe(true);
    expect(checkAction(level2, 'post', {})).toBe(false);
    expect(checkAction(level2, 'delete_post', {})).toBe(false);
    expect(checkAction(level2, 'ban', {})).toBe(false);
    expect(checkAction(level2, 'react', {})).toBe(true);
  });
});

// ── Discord deny tests ─────────────────────────────────────────────────────────

describe('deny for Discord send_message', () => {
  it('!send_message(jid=discord:*) denies jid=discord:123456', () => {
    expect(
      checkAction(['!send_message(jid=discord:*)'], 'send_message', {
        jid: 'discord:123456',
      }),
    ).toBe(false);
  });

  it('!send_message(jid=discord:*) denies jid=discord:channel-abc', () => {
    expect(
      checkAction(['!send_message(jid=discord:*)'], 'send_message', {
        jid: 'discord:channel-abc',
      }),
    ).toBe(false);
  });

  it('!send_message(jid=discord:*) does NOT deny jid=telegram:123', () => {
    expect(
      checkAction(['!send_message(jid=discord:*)'], 'send_message', {
        jid: 'telegram:123',
      }),
    ).toBe(false);
  });

  it('!send_reply(jid=discord:*) denies jid=discord:123456', () => {
    expect(
      checkAction(['!send_reply(jid=discord:*)'], 'send_reply', {
        jid: 'discord:123456',
      }),
    ).toBe(false);
  });

  it('!send_reply(jid=discord:*) does NOT deny jid=telegram:123', () => {
    expect(
      checkAction(['!send_reply(jid=discord:*)'], 'send_reply', {
        jid: 'telegram:123',
      }),
    ).toBe(false);
  });

  it('star allows everything but discord send_message deny overrides', () => {
    const rules = ['*', '!send_message(jid=discord:*)'];
    expect(checkAction(rules, 'send_message', { jid: 'discord:999' })).toBe(
      false,
    );
    expect(checkAction(rules, 'send_message', { jid: 'telegram:999' })).toBe(
      true,
    );
    expect(checkAction(rules, 'send_reply', { jid: 'discord:999' })).toBe(true);
  });
});

describe('share_mount grant override', () => {
  it('tier-1 group has share_mount RW by default', () => {
    const rules = deriveRules('world', 1);
    expect(checkAction(rules, 'share_mount', { readonly: 'false' })).toBe(true);
    expect(checkAction(rules, 'share_mount', { readonly: 'true' })).toBe(false);
  });

  it('tier-2 group has share_mount RO by default', () => {
    const rules = deriveRules('world/child', 2);
    expect(checkAction(rules, 'share_mount', { readonly: 'true' })).toBe(true);
    expect(checkAction(rules, 'share_mount', { readonly: 'false' })).toBe(
      false,
    );
  });

  it('!share_mount override blocks share mount RW for tier-1', () => {
    const base = deriveRules('world', 1);
    const allRules = [...base, '!share_mount'];
    expect(checkAction(allRules, 'share_mount', { readonly: 'false' })).toBe(
      false,
    );
  });

  it('!share_mount override blocks share mount RO for tier-2', () => {
    const base = deriveRules('world/child', 2);
    const allRules = [...base, '!share_mount'];
    expect(checkAction(allRules, 'share_mount', { readonly: 'true' })).toBe(
      false,
    );
  });

  it('root tier-0 has share_mount via wildcard', () => {
    const rules = deriveRules('root', 0);
    expect(checkAction(rules, 'share_mount', { readonly: 'false' })).toBe(true);
    expect(checkAction(rules, 'share_mount', { readonly: 'true' })).toBe(true);
  });
});
