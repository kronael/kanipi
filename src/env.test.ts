import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

// We'll override readFileSync per test via module-level mock
let fakeContent: string | null = null;

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn((_path: string) => {
        if (fakeContent === null) throw new Error('ENOENT');
        return fakeContent;
      }),
    },
  };
});

import { readEnvFile } from './env.js';

beforeEach(() => {
  vi.resetAllMocks();
  fakeContent = null;
});

// --- basic parsing ---

describe('readEnvFile', () => {
  it('returns empty object when .env is missing', () => {
    fakeContent = null;
    expect(readEnvFile(['KEY'])).toEqual({});
  });

  it('parses plain key=value', () => {
    fakeContent = 'FOO=bar\n';
    expect(readEnvFile(['FOO'])).toEqual({ FOO: 'bar' });
  });

  it('parses double-quoted value', () => {
    fakeContent = 'TOKEN="abc123"\n';
    expect(readEnvFile(['TOKEN'])).toEqual({ TOKEN: 'abc123' });
  });

  it('parses single-quoted value', () => {
    fakeContent = "SECRET='mysecret'\n";
    expect(readEnvFile(['SECRET'])).toEqual({ SECRET: 'mysecret' });
  });

  it('ignores lines starting with #', () => {
    fakeContent = '# comment\nFOO=bar\n';
    expect(readEnvFile(['FOO'])).toEqual({ FOO: 'bar' });
  });

  it('ignores blank lines', () => {
    fakeContent = '\n\nFOO=bar\n\n';
    expect(readEnvFile(['FOO'])).toEqual({ FOO: 'bar' });
  });

  it('ignores lines without =', () => {
    fakeContent = 'INVALID\nFOO=bar\n';
    expect(readEnvFile(['FOO', 'INVALID'])).toEqual({ FOO: 'bar' });
  });

  it('only returns requested keys', () => {
    fakeContent = 'FOO=a\nBAR=b\nBAZ=c\n';
    expect(readEnvFile(['FOO', 'BAZ'])).toEqual({ FOO: 'a', BAZ: 'c' });
  });

  it('trims whitespace around key and value', () => {
    fakeContent = '  FOO = bar  \n';
    expect(readEnvFile(['FOO'])).toEqual({ FOO: 'bar' });
  });

  it('skips keys with empty values', () => {
    fakeContent = 'EMPTY=\n';
    expect(readEnvFile(['EMPTY'])).toEqual({});
  });

  it('handles value with = sign in it', () => {
    fakeContent = 'URL=https://example.com?a=1&b=2\n';
    expect(readEnvFile(['URL'])).toEqual({
      URL: 'https://example.com?a=1&b=2',
    });
  });

  it('returns empty object for empty key list', () => {
    fakeContent = 'FOO=bar\n';
    expect(readEnvFile([])).toEqual({});
  });
});
