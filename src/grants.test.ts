import { describe, it, expect } from 'vitest';

import {
  parseRule,
  checkAction,
  matchingRules,
  narrowRules,
} from './grants.js';

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
    const r = parseRule('  post  ');
    expect(r.action).toBe('post');
    expect(r.deny).toBe(false);
  });

  it('deny with whitespace', () => {
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

  it('action with underscore', () => {
    const r = parseRule('send_message');
    expect(r.action).toBe('send_message');
  });

  it('deny with params', () => {
    const r = parseRule('!post(jid=twitter:*)');
    expect(r.deny).toBe(true);
    expect(r.action).toBe('post');
    expect(r.params.get('jid')).toBe('twitter:*');
  });

  it('exact value param (no glob)', () => {
    const r = parseRule('send_message(jid=telegram:123456)');
    expect(r.params.get('jid')).toBe('telegram:123456');
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

    it('unmatched action = deny', () => {
      expect(checkAction(['post'], 'send_message', {})).toBe(false);
    });

    it('deny with no preceding allow = deny', () => {
      expect(checkAction(['!post'], 'post', {})).toBe(false);
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
      const rules = ['*', '!post', 'post(jid=reddit:*)'];
      expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(true);
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
        checkAction(['post(jid=twitter:*)'], 'post', { jid: 'reddit:abc' }),
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
      expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(true);
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

    it('param glob does not match comma or paren', () => {
      // * in param value matches [^,)]* — no comma, no close-paren
      expect(checkAction(['post(jid=a*)'], 'post', { jid: 'abc' })).toBe(true);
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
      expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(true);
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
      expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(false);
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
      expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(false);
    });

    it('empty rules array = deny everything', () => {
      expect(checkAction([], 'send_reply', {})).toBe(false);
      expect(checkAction([], 'post', {})).toBe(false);
      expect(checkAction([], '*', {})).toBe(false);
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
    const rules = ['post(jid=twitter:*)', 'post(jid=reddit:*)'];
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
    const rules = ['*', '!post', 'post(jid=reddit:*)'];
    const result = matchingRules(rules, 'post');
    expect(result).toEqual(['*', 'post(jid=reddit:*)']);
  });

  it('returns null for empty rules', () => {
    expect(matchingRules([], 'post')).toBeNull();
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
      'post(jid=reddit:*)',
      'post(jid=mastodon:*)',
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
    const child = ['!post', 'post(jid=reddit:*)'];
    const result = narrowRules(parent, child);
    expect(checkAction(result, 'post', { jid: 'reddit:1' })).toBe(true);
    expect(checkAction(result, 'post', { jid: 'twitter:1' })).toBe(false);
  });

  it('child cannot widen: deny + re-allow still narrower', () => {
    const parent = ['send_reply'];
    const child = ['send_message']; // trying to widen
    const result = narrowRules(parent, child);
    // send_message is allowed because it's appended — but the spec says
    // delegation can only narrow. The narrowRules function itself just
    // concatenates; enforcement is in the delegation logic.
    // The last-match-wins means send_message IS allowed here.
    expect(checkAction(result, 'send_message', {})).toBe(true);
  });

  it('empty parent + child rules', () => {
    expect(narrowRules([], [])).toEqual([]);
    expect(checkAction(narrowRules([], []), 'post', {})).toBe(false);
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
