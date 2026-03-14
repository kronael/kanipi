import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SLINK_ANON_RPM,
  _overrideConfig,
  _resetConfig,
  permissionTier,
  isRoot,
} from './config.js';

describe('_overrideConfig', () => {
  const original = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = original;
    _resetConfig();
  });

  it('overrides SLINK_ANON_RPM live binding', () => {
    _overrideConfig({ SLINK_ANON_RPM: 99 });
    // Re-import via the module to check live binding
    expect(SLINK_ANON_RPM).toBe(99);
  });

  it('is a no-op outside test environment', () => {
    process.env.NODE_ENV = 'production';
    _overrideConfig({ SLINK_ANON_RPM: 1 });
    expect(SLINK_ANON_RPM).not.toBe(1);
  });
});

describe('_resetConfig', () => {
  const original = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env.NODE_ENV = original;
    _resetConfig();
  });

  it('restores overridden values to defaults', () => {
    const before = SLINK_ANON_RPM;
    _overrideConfig({ SLINK_ANON_RPM: 999 });
    expect(SLINK_ANON_RPM).toBe(999);
    _resetConfig();
    expect(SLINK_ANON_RPM).toBe(before);
  });

  it('is a no-op outside test environment', () => {
    _overrideConfig({ SLINK_ANON_RPM: 999 });
    process.env.NODE_ENV = 'production';
    _resetConfig(); // should not reset
    process.env.NODE_ENV = 'test';
    expect(SLINK_ANON_RPM).toBe(999);
  });
});

describe('permissionTier', () => {
  it('root folder is tier 0', () => {
    expect(permissionTier('root')).toBe(0);
  });

  it('top-level folder is tier 1', () => {
    expect(permissionTier('atlas')).toBe(1);
  });

  it('depth 2 is tier 2', () => {
    expect(permissionTier('atlas/support')).toBe(2);
  });

  it('depth 3 is tier 3', () => {
    expect(permissionTier('atlas/support/web')).toBe(3);
  });

  it('depth 4+ is clamped to tier 3', () => {
    expect(permissionTier('a/b/c/d')).toBe(3);
    expect(permissionTier('a/b/c/d/e')).toBe(3);
  });
});

describe('isRoot', () => {
  it('root returns true', () => {
    expect(isRoot('root')).toBe(true);
  });

  it('non-root returns false', () => {
    expect(isRoot('atlas')).toBe(false);
    expect(isRoot('root/child')).toBe(false);
    expect(isRoot('')).toBe(false);
  });
});
