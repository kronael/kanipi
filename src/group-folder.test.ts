import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  decodeFolderPath,
  encodeFolderPath,
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from './group-folder.js';

describe('group folder validation', () => {
  it('accepts normal group folder names', () => {
    expect(isValidGroupFolder('root')).toBe(true);
    expect(isValidGroupFolder('family-chat')).toBe(true);
    expect(isValidGroupFolder('Team_42')).toBe(true);
  });

  it('accepts hierarchical folder names with /', () => {
    expect(isValidGroupFolder('a/b')).toBe(true);
    expect(isValidGroupFolder('a/b/c')).toBe(true);
  });

  it('rejects traversal and reserved names', () => {
    expect(isValidGroupFolder('a/../b')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
    expect(isValidGroupFolder('share')).toBe(false);
    expect(isValidGroupFolder('')).toBe(false);
  });

  it('resolves safe paths under groups directory', () => {
    const resolved = resolveGroupFolderPath('family-chat');
    expect(resolved.endsWith(`${path.sep}groups${path.sep}family-chat`)).toBe(
      true,
    );
  });

  it('resolves safe paths under data ipc directory', () => {
    const resolved = resolveGroupIpcPath('family-chat');
    expect(
      resolved.endsWith(`${path.sep}data${path.sep}ipc${path.sep}family-chat`),
    ).toBe(true);
  });

  it('throws for unsafe folder names', () => {
    expect(() => resolveGroupFolderPath('../../etc')).toThrow();
    expect(() => resolveGroupIpcPath('/tmp')).toThrow();
  });
});

describe('folder path encoding', () => {
  it('encodes simple folder unchanged', () => {
    expect(encodeFolderPath('root')).toBe('root');
  });

  it('encodes slashes as single dash', () => {
    expect(encodeFolderPath('atlas/support')).toBe('atlas-support');
  });

  it('escapes dashes before encoding slashes', () => {
    expect(encodeFolderPath('atlas-v2')).toBe('atlas--v2');
  });

  it('handles folder with both dashes and slashes', () => {
    expect(encodeFolderPath('my-world/sub-group')).toBe('my--world-sub--group');
  });

  it('roundtrips through decode', () => {
    for (const folder of [
      'root',
      'atlas/support',
      'atlas-v2',
      'a/b/c',
      'a-b/c-d/e',
    ]) {
      expect(decodeFolderPath(encodeFolderPath(folder))).toBe(folder);
    }
  });

  it('decodes encoded paths', () => {
    expect(decodeFolderPath('root')).toBe('root');
    expect(decodeFolderPath('atlas-support')).toBe('atlas/support');
    expect(decodeFolderPath('atlas--v2')).toBe('atlas-v2');
  });
});
