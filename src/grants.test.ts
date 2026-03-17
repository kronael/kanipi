import { describe, it, expect } from 'vitest';

import {
  parseRule,
  checkAction,
  matchingRules,
  narrowRules,
} from './grants.js';

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
});

describe('checkAction', () => {
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

  it('deny overrides allow (last match wins)', () => {
    expect(checkAction(['post', '!post'], 'post', {})).toBe(false);
  });

  it('allow after deny re-allows', () => {
    expect(checkAction(['!post', 'post'], 'post', {})).toBe(true);
  });

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

  it('wildcard in action name', () => {
    expect(checkAction(['send_*'], 'send_message', {})).toBe(true);
    expect(checkAction(['send_*'], 'send_reply', {})).toBe(true);
    expect(checkAction(['send_*'], 'post', {})).toBe(false);
  });

  it('complex scenario: tier 3 defaults', () => {
    const rules = ['send_reply'];
    expect(checkAction(rules, 'send_reply', {})).toBe(true);
    expect(checkAction(rules, 'send_message', {})).toBe(false);
    expect(checkAction(rules, 'post', {})).toBe(false);
  });

  it('complex scenario: allow all then deny specific', () => {
    const rules = ['*', '!post(jid=twitter:*)'];
    expect(checkAction(rules, 'reply', { jid: 'twitter:1' })).toBe(true);
    expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(true);
    expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
  });
});

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
});

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
});
