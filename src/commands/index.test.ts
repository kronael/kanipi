import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('../config.js', () => ({ DATA_DIR: '/test/data' }));

describe('command registry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registerCommand + findCommand returns handler by name', async () => {
    const { registerCommand, findCommand } = await import('./index.js');
    const h = { name: 'foo', description: 'Foo', handle: async () => {} };
    registerCommand(h);
    expect(findCommand('foo')).toBe(h);
  });

  it('findCommand returns undefined for unknown name', async () => {
    const { findCommand } = await import('./index.js');
    expect(findCommand('missing')).toBeUndefined();
  });

  it('writeCommandsXml calls mkdirSync with path containing groupFolder', async () => {
    const fsMod = await import('fs');
    const { registerCommand, writeCommandsXml } = await import('./index.js');
    registerCommand({
      name: 'cmd1',
      description: 'Cmd1',
      handle: async () => {},
    });
    writeCommandsXml('mygroup');
    expect(fsMod.default.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('mygroup'),
      { recursive: true },
    );
  });

  it('writeCommandsXml writes XML containing command name entry', async () => {
    const fsMod = await import('fs');
    const { registerCommand, writeCommandsXml } = await import('./index.js');
    registerCommand({
      name: 'testcmd',
      description: 'Test',
      handle: async () => {},
    });
    writeCommandsXml('grp');
    expect(fsMod.default.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('grp'),
      expect.stringContaining('testcmd'),
    );
  });
});
