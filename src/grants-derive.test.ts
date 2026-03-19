/**
 * Tests for deriveRules — tier-based rule generation from routing table.
 *
 * Uses real in-memory SQLite to set up routes and verify derived grants.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, _setTestGroupRoute, addRoute } from './db.js';
import { deriveRules, checkAction } from './grants.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('deriveRules — tier 0 (root)', () => {
  it('returns wildcard for root', () => {
    _setTestGroupRoute('tg:root', { name: 'Root', folder: 'root' });
    const rules = deriveRules('root', 0);
    expect(rules).toEqual(['*']);
  });

  it('wildcard allows everything', () => {
    const rules = deriveRules('root', 0);
    expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(true);
    expect(checkAction(rules, 'send_message', {})).toBe(true);
    expect(checkAction(rules, 'delegate_group', {})).toBe(true);
    expect(checkAction(rules, 'anything', {})).toBe(true);
  });
});

describe('deriveRules — tier 3+ (leaf)', () => {
  it('returns only send_reply', () => {
    const rules = deriveRules('root/child/leaf', 3);
    expect(rules).toEqual(['send_reply']);
  });

  it('only send_reply is allowed', () => {
    const rules = deriveRules('root/child/leaf', 3);
    expect(checkAction(rules, 'send_reply', {})).toBe(true);
    expect(checkAction(rules, 'send_message', {})).toBe(false);
    expect(checkAction(rules, 'post', {})).toBe(false);
    expect(checkAction(rules, 'delegate_group', {})).toBe(false);
    expect(checkAction(rules, 'schedule_task', {})).toBe(false);
  });
});

describe('deriveRules — tier 1 (world root)', () => {
  it('generates platform-scoped social + messaging rules', () => {
    // Set up routes: telegram JID routed to atlas world
    _setTestGroupRoute('telegram:group1', {
      name: 'Atlas Chat',
      folder: 'atlas',
    });
    addRoute('twitter:atlas_account', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'atlas/social',
    });

    const rules = deriveRules('atlas', 1);

    // Should have telegram and twitter platform rules
    expect(checkAction(rules, 'post', { jid: 'telegram:123' })).toBe(true);
    expect(checkAction(rules, 'post', { jid: 'twitter:123' })).toBe(true);
    expect(checkAction(rules, 'react', { jid: 'telegram:abc' })).toBe(true);
    expect(checkAction(rules, 'send_message', { jid: 'telegram:1' })).toBe(
      true,
    );
    expect(checkAction(rules, 'send_reply', {})).toBe(true);

    // Should NOT allow post with no jid (param required by rules)
    expect(checkAction(rules, 'post', {})).toBe(false);

    // Should NOT allow unknown platform
    expect(checkAction(rules, 'post', { jid: 'mastodon:1' })).toBe(false);

    // Non-platform actions
    expect(checkAction(rules, 'schedule_task', {})).toBe(true);
    expect(checkAction(rules, 'delegate_group', {})).toBe(true);
    expect(checkAction(rules, 'register_group', {})).toBe(true);
    expect(checkAction(rules, 'get_routes', {})).toBe(true);
    expect(checkAction(rules, 'add_route', {})).toBe(true);
    expect(checkAction(rules, 'delete_route', {})).toBe(true);
    expect(checkAction(rules, 'refresh_groups', {})).toBe(true);
    expect(checkAction(rules, 'reset_session', {})).toBe(true);
    expect(checkAction(rules, 'inject_message', {})).toBe(true);
  });

  it('world with no routes yields no platform rules', () => {
    // No routes for 'empty' world
    const rules = deriveRules('empty', 1);

    // Only non-platform actions
    expect(checkAction(rules, 'send_reply', {})).toBe(true);
    expect(checkAction(rules, 'schedule_task', {})).toBe(true);
    expect(checkAction(rules, 'delegate_group', {})).toBe(true);

    // No platform rules → post not allowed
    expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
    expect(checkAction(rules, 'send_message', { jid: 'telegram:1' })).toBe(
      false,
    );
  });

  it('routes to children of world are included for tier 1', () => {
    _setTestGroupRoute('reddit:main', {
      name: 'Atlas',
      folder: 'atlas',
    });
    addRoute('discord:gaming', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'atlas/gaming',
    });

    const rules = deriveRules('atlas', 1);
    // discord routes to atlas/gaming, which is in atlas world
    expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(true);
    expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(true);
  });
});

describe('deriveRules — tier 2', () => {
  it('generates rules scoped to self and children platforms', () => {
    _setTestGroupRoute('telegram:main', {
      name: 'Atlas',
      folder: 'atlas',
    });
    addRoute('reddit:support', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'atlas/support',
    });

    const rules = deriveRules('atlas/support', 2);

    // reddit is routed to atlas/support → should be allowed
    expect(checkAction(rules, 'post', { jid: 'reddit:1' })).toBe(true);
    expect(checkAction(rules, 'send_message', { jid: 'reddit:1' })).toBe(true);
    expect(checkAction(rules, 'send_file', { jid: 'reddit:1' })).toBe(true);
    expect(checkAction(rules, 'react', { jid: 'reddit:1' })).toBe(true);

    // telegram is routed to atlas (parent), NOT atlas/support → not allowed
    expect(checkAction(rules, 'post', { jid: 'telegram:1' })).toBe(false);
    expect(checkAction(rules, 'send_message', { jid: 'telegram:1' })).toBe(
      false,
    );

    // Non-platform actions
    expect(checkAction(rules, 'send_reply', {})).toBe(true);
    expect(checkAction(rules, 'schedule_task', {})).toBe(true);
    expect(checkAction(rules, 'delegate_group', {})).toBe(true);
    expect(checkAction(rules, 'escalate_group', {})).toBe(true);
    expect(checkAction(rules, 'reset_session', {})).toBe(true);
    expect(checkAction(rules, 'inject_message', {})).toBe(true);

    // Tier 2 does NOT get routing actions
    expect(checkAction(rules, 'get_routes', {})).toBe(false);
    expect(checkAction(rules, 'add_route', {})).toBe(false);
    expect(checkAction(rules, 'register_group', {})).toBe(false);
    expect(checkAction(rules, 'refresh_groups', {})).toBe(false);
  });

  it('tier 2 with no routes gets only non-platform actions', () => {
    const rules = deriveRules('isolated/child', 2);

    expect(checkAction(rules, 'send_reply', {})).toBe(true);
    expect(checkAction(rules, 'schedule_task', {})).toBe(true);
    expect(checkAction(rules, 'delegate_group', {})).toBe(true);

    expect(checkAction(rules, 'post', { jid: 'twitter:1' })).toBe(false);
    expect(checkAction(rules, 'send_message', { jid: 'telegram:1' })).toBe(
      false,
    );
  });

  it('tier 2 includes routes to children', () => {
    _setTestGroupRoute('telegram:main', {
      name: 'Root',
      folder: 'root',
    });
    addRoute('discord:child_chat', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'root/parent/child',
    });

    // parent includes child routes
    const rules = deriveRules('root/parent', 2);
    expect(checkAction(rules, 'post', { jid: 'discord:1' })).toBe(true);
  });
});

describe('deriveRules — email JIDs excluded from platforms', () => {
  it('email-style JIDs do not create platform rules', () => {
    addRoute('user@example.com', {
      seq: 0,
      type: 'default',
      match: null,
      target: 'atlas',
    });

    const rules = deriveRules('atlas', 1);
    // user@example.com has @ in platform part → excluded
    // Only non-platform actions available (if no other routes)
    expect(checkAction(rules, 'post', { jid: 'user@example.com:1' })).toBe(
      false,
    );
  });
});

describe('deriveRules uses default tier from config when not specified', () => {
  it('deep folder defaults to tier 3', () => {
    const rules = deriveRules('a/b/c');
    expect(rules).toEqual(['send_reply']);
  });
});
