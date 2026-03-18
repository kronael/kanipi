import { describe, it, expect } from 'vitest';

import { worldOf, isInWorld, isDirectChild } from './permissions.js';

describe('worldOf', () => {
  it('returns first segment', () => {
    expect(worldOf('atlas')).toBe('atlas');
    expect(worldOf('atlas/support')).toBe('atlas');
    expect(worldOf('atlas/support/web')).toBe('atlas');
  });
});

describe('isInWorld', () => {
  it('same world returns true', () => {
    expect(isInWorld('atlas', 'atlas/support')).toBe(true);
    expect(isInWorld('atlas/support', 'atlas/web')).toBe(true);
  });

  it('different worlds return false', () => {
    expect(isInWorld('atlas', 'yonder/support')).toBe(false);
    expect(isInWorld('atlas/support', 'yonder')).toBe(false);
  });
});

describe('isDirectChild', () => {
  it('direct child returns true', () => {
    expect(isDirectChild('atlas', 'atlas/support')).toBe(true);
  });

  it('grandchild returns false', () => {
    expect(isDirectChild('atlas', 'atlas/support/web')).toBe(false);
  });

  it('same folder returns false', () => {
    expect(isDirectChild('atlas', 'atlas')).toBe(false);
  });

  it('sibling returns false', () => {
    expect(isDirectChild('atlas', 'yonder/support')).toBe(false);
  });

  it('prefix overlap does not match (atlas vs atlas2/foo)', () => {
    expect(isDirectChild('atlas', 'atlas2/foo')).toBe(false);
  });
});
