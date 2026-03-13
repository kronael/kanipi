import path from 'path';

import { describe, expect, it } from 'vitest';

import {
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

  it('accepts sender-derived folder names', () => {
    expect(isValidGroupFolder('atlas/wa-5551234@s.whatsapp.net')).toBe(true);
    expect(isValidGroupFolder('atlas/em-user@example.com')).toBe(true);
    expect(isValidGroupFolder('atlas/tg-123456')).toBe(true);
  });

  it('rejects traversal and empty', () => {
    expect(isValidGroupFolder('a/../b')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
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
