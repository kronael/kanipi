import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  normalizeRelPath,
  resolveWithinRoot,
  denyReason,
  humanSize,
} from './file.js';

describe('normalizeRelPath', () => {
  it('strips leading slashes', () => {
    expect(normalizeRelPath('///foo/bar')).toBe('foo/bar');
  });

  it('rejects empty string', () => {
    expect(normalizeRelPath('')).toBeNull();
  });

  it('rejects bare dot', () => {
    expect(normalizeRelPath('.')).toBeNull();
  });

  it('rejects tilde paths', () => {
    expect(normalizeRelPath('~/secret')).toBeNull();
  });

  it('rejects .. traversal', () => {
    expect(normalizeRelPath('foo/../etc/passwd')).toBeNull();
  });

  it('rejects .git segments', () => {
    expect(normalizeRelPath('foo/.git/config')).toBeNull();
  });

  it('accepts normal relative path', () => {
    expect(normalizeRelPath('docs/readme.md')).toBe('docs/readme.md');
  });

  it('normalizes redundant separators', () => {
    expect(normalizeRelPath('foo//bar')).toBe('foo/bar');
  });
});

describe('resolveWithinRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves path within root', () => {
    const r = resolveWithinRoot(tmpDir, 'foo/bar.txt');
    expect(r).toBe(path.join(tmpDir, 'foo/bar.txt'));
  });

  it('rejects path that escapes root', () => {
    expect(resolveWithinRoot(tmpDir, '../../../etc/passwd')).toBeNull();
  });

  it('rejects symlink escape when target exists', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'escape-'));
    fs.writeFileSync(path.join(outer, 'secret'), 'x');
    const inner = path.join(tmpDir, 'inner');
    fs.mkdirSync(inner);
    fs.symlinkSync(outer, path.join(inner, 'link'));
    expect(resolveWithinRoot(tmpDir, 'inner/link/secret')).toBeNull();
    fs.rmSync(outer, { recursive: true, force: true });
  });
});

describe('denyReason', () => {
  it('denies .git paths by default', () => {
    expect(denyReason('.git/config', [])).toBeTruthy();
  });

  it('allows normal paths with empty globs', () => {
    expect(denyReason('src/index.ts', [])).toBeNull();
  });

  it('matches custom glob', () => {
    expect(denyReason('secrets/key.pem', ['secrets/**'])).toBeTruthy();
  });

  it('passes paths not matching glob', () => {
    expect(denyReason('src/main.ts', ['secrets/**'])).toBeNull();
  });

  it('matches wildcard in filename', () => {
    expect(denyReason('.env', ['.*'])).toBeTruthy();
  });
});

describe('humanSize', () => {
  it('formats bytes', () => {
    expect(humanSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(humanSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats gigabytes', () => {
    expect(humanSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });
});
