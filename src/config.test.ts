import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SLINK_ANON_RPM,
  WHISPER_BASE_URL,
  _overrideConfig,
  _resetConfig,
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

  it('overrides WHISPER_BASE_URL live binding', () => {
    _overrideConfig({ WHISPER_BASE_URL: 'http://test:9999' });
    expect(WHISPER_BASE_URL).toBe('http://test:9999');
  });

  it('is a no-op outside test environment', () => {
    process.env.NODE_ENV = 'production';
    _overrideConfig({ SLINK_ANON_RPM: 1 });
    expect(SLINK_ANON_RPM).not.toBe(1);
  });
});
