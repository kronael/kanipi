import { describe, it, expect } from 'vitest';

import { worldOf, isInWorld, isDirectChild } from './permissions.js';
import { permissionTier, isRoot } from './config.js';

describe('permissionTier', () => {
  it('root folder is tier 0', () => {
    expect(permissionTier('root')).toBe(0);
  });

  it('top-level non-root folders are tier 1', () => {
    expect(permissionTier('atlas')).toBe(1);
    expect(permissionTier('yonder')).toBe(1);
  });

  it('depth 2 is tier 2', () => {
    expect(permissionTier('atlas/support')).toBe(2);
  });

  it('depth 3+ is clamped to tier 3', () => {
    expect(permissionTier('atlas/support/web')).toBe(3);
    expect(permissionTier('a/b/c/d')).toBe(3);
  });
});

describe('isRoot', () => {
  it('only root folder is root', () => {
    expect(isRoot('root')).toBe(true);
    expect(isRoot('atlas')).toBe(false);
  });
});

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
