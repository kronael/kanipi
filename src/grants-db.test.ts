/**
 * Tests for grants DB operations: getGrantOverrides, setGrantOverrides,
 * deleteGrantOverrides. Uses real in-memory SQLite via _initTestDatabase.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getDatabase } from './db.js';
import {
  getGrantOverrides,
  setGrantOverrides,
  deleteGrantOverrides,
} from './grants.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('grant overrides DB round-trip', () => {
  it('returns null when no overrides exist', () => {
    expect(getGrantOverrides('root')).toBeNull();
  });

  it('overwrites existing overrides', () => {
    setGrantOverrides('root/child', ['*']);
    setGrantOverrides('root/child', ['send_reply']);
    expect(getGrantOverrides('root/child')).toEqual(['send_reply']);
  });

  it('delete removes overrides', () => {
    setGrantOverrides('root/child', ['send_reply']);
    deleteGrantOverrides('root/child');
    expect(getGrantOverrides('root/child')).toBeNull();
  });

  it('delete on non-existent is no-op', () => {
    deleteGrantOverrides('nonexistent');
    expect(getGrantOverrides('nonexistent')).toBeNull();
  });

  it('different folders have independent overrides', () => {
    setGrantOverrides('a', ['*']);
    setGrantOverrides('b', ['send_reply']);
    expect(getGrantOverrides('a')).toEqual(['*']);
    expect(getGrantOverrides('b')).toEqual(['send_reply']);
  });

  it('empty array stored and retrieved', () => {
    setGrantOverrides('root', []);
    expect(getGrantOverrides('root')).toEqual([]);
  });

  it('complex rules stored and retrieved', () => {
    const rules = [
      'send_message(jid=telegram:*)',
      '!post(jid=twitter:nsfw)',
      'react(jid=reddit:*)',
      'send_reply',
    ];
    setGrantOverrides('root/child', rules);
    expect(getGrantOverrides('root/child')).toEqual(rules);
  });

  it('returns null for corrupted JSON in DB', () => {
    getDatabase()
      .prepare('INSERT OR REPLACE INTO grants (folder, rules) VALUES (?, ?)')
      .run('bad', 'not valid json {{{');
    expect(getGrantOverrides('bad')).toBeNull();
  });
});
