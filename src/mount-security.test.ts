/**
 * mount-security tests.
 *
 * The module caches the allowlist after first load, so each describe block
 * uses vi.resetModules() + a fresh dynamic import to get clean state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';

vi.mock('./config.js', () => ({
  MOUNT_ALLOWLIST_PATH: '/fake/.config/nanoclaw/mount-allowlist.json',
}));

vi.mock('pino', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { default: vi.fn(() => logger) };
});

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAllowlist(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    allowedRoots: [],
    blockedPatterns: [],
    nonMainReadOnly: true,
    ...overrides,
  });
}

// Create a real temp dir so realpathSync works
function tmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'mount-sec-'));
}

// ── loadMountAllowlist ────────────────────────────────────────────────────────

describe('loadMountAllowlist', () => {
  async function load(fsOverrides: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, default: { ...actual, ...fsOverrides } };
    });
    const { loadMountAllowlist } = await import('./mount-security.js');
    return loadMountAllowlist;
  }

  it('returns null when allowlist file does not exist', async () => {
    const fn = await load({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(),
    });
    expect(fn()).toBeNull();
  });

  it('returns null when file content is invalid JSON', async () => {
    const fn = await load({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() => 'not json'),
    });
    expect(fn()).toBeNull();
  });

  it('returns null when allowedRoots is not an array', async () => {
    const fn = await load({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          allowedRoots: 'bad',
          blockedPatterns: [],
          nonMainReadOnly: true,
        }),
      ),
    });
    expect(fn()).toBeNull();
  });

  it('returns null when nonMainReadOnly is not boolean', async () => {
    const fn = await load({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        JSON.stringify({
          allowedRoots: [],
          blockedPatterns: [],
          nonMainReadOnly: 'yes',
        }),
      ),
    });
    expect(fn()).toBeNull();
  });

  it('merges default blocked patterns with custom ones', async () => {
    const fn = await load({
      existsSync: vi.fn(() => true),
      readFileSync: vi.fn(() =>
        makeAllowlist({ blockedPatterns: ['custom-secret'] }),
      ),
    });
    const result = fn();
    expect(result).not.toBeNull();
    expect(result!.blockedPatterns).toContain('.ssh');
    expect(result!.blockedPatterns).toContain('custom-secret');
  });

  it('caches result on second call', async () => {
    const readFileSync = vi.fn(() => makeAllowlist());
    const fn = await load({
      existsSync: vi.fn(() => true),
      readFileSync,
    });
    fn();
    fn();
    expect(readFileSync).toHaveBeenCalledTimes(1);
  });
});

// ── validateMount ─────────────────────────────────────────────────────────────

describe('validateMount: no allowlist', () => {
  it('blocks all mounts when allowlist missing', async () => {
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: { ...actual, existsSync: vi.fn(() => false) },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/some/path' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/No mount allowlist/);
  });
});

describe('validateMount: container path validation', () => {
  async function getValidateMount(realDir: string) {
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            makeAllowlist({
              allowedRoots: [
                { path: realDir, allowReadWrite: true, description: 'tmp' },
              ],
            }),
          ),
          realpathSync: actual.realpathSync,
        },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    return validateMount;
  }

  it('rejects container path with .. traversal', async () => {
    const dir = tmpDir();
    const validateMount = await getValidateMount(dir);
    const result = validateMount(
      { hostPath: dir, containerPath: '../escape' },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Invalid container path/);
  });

  it('rejects absolute container path', async () => {
    const dir = tmpDir();
    const validateMount = await getValidateMount(dir);
    const result = validateMount(
      { hostPath: dir, containerPath: '/absolute/path' },
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Invalid container path/);
  });

  it('rejects empty container path', async () => {
    const dir = tmpDir();
    const validateMount = await getValidateMount(dir);
    const result = validateMount({ hostPath: dir, containerPath: '   ' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Invalid container path/);
  });
});

describe('validateMount: host path existence', () => {
  it('rejects non-existent host path', async () => {
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() => makeAllowlist()),
          realpathSync: vi.fn(() => {
            throw new Error('ENOENT');
          }),
        },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: '/does/not/exist' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/does not exist/);
  });
});

describe('validateMount: blocked patterns', () => {
  async function getValidateMount() {
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() => makeAllowlist()),
          realpathSync: vi.fn((p: string) => p),
        },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    return validateMount;
  }

  it('blocks paths containing .ssh', async () => {
    const validateMount = await getValidateMount();
    const result = validateMount({ hostPath: '/home/user/.ssh' }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/\.ssh/);
  });

  it('blocks paths containing .aws', async () => {
    const validateMount = await getValidateMount();
    const result = validateMount(
      { hostPath: '/home/user/.aws/credentials' },
      true,
    );
    expect(result.allowed).toBe(false);
  });

  it('blocks paths with id_rsa in name', async () => {
    const validateMount = await getValidateMount();
    const result = validateMount(
      { hostPath: '/home/user/keys/id_rsa.pub' },
      true,
    );
    expect(result.allowed).toBe(false);
  });

  it('blocks paths containing .env', async () => {
    const validateMount = await getValidateMount();
    const result = validateMount({ hostPath: '/home/user/project/.env' }, true);
    expect(result.allowed).toBe(false);
  });
});

describe('validateMount: allowed roots', () => {
  it('allows path under an allowed root', async () => {
    const dir = tmpDir();
    const subdir = path.join(dir, 'subdir');
    mkdirSync(subdir);

    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            makeAllowlist({
              allowedRoots: [
                { path: dir, allowReadWrite: true, description: 'test root' },
              ],
            }),
          ),
          realpathSync: actual.realpathSync,
        },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: subdir }, true);
    expect(result.allowed).toBe(true);
    expect(result.reason).toMatch(/Allowed under root/);
  });

  it('blocks path not under any allowed root', async () => {
    const dir = tmpDir();
    const otherDir = tmpDir();

    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            makeAllowlist({
              allowedRoots: [
                { path: dir, allowReadWrite: false, description: 'test root' },
              ],
            }),
          ),
          realpathSync: actual.realpathSync,
        },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    const result = validateMount({ hostPath: otherDir }, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not under any allowed root/);
  });
});

describe('validateMount: readonly enforcement', () => {
  async function setup(rootAllowReadWrite: boolean, nonMainReadOnly: boolean) {
    const dir = tmpDir();
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            makeAllowlist({
              allowedRoots: [
                {
                  path: dir,
                  allowReadWrite: rootAllowReadWrite,
                  description: 'root',
                },
              ],
              nonMainReadOnly,
            }),
          ),
          realpathSync: actual.realpathSync,
        },
      };
    });
    const { validateMount } = await import('./mount-security.js');
    return { validateMount, dir };
  }

  it('defaults to readonly even when not specified', async () => {
    const { validateMount, dir } = await setup(true, false);
    // readonly not specified → defaults to readonly
    const result = validateMount({ hostPath: dir }, true);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });

  it('allows read-write for main group when root permits', async () => {
    const { validateMount, dir } = await setup(true, true);
    const result = validateMount({ hostPath: dir, readonly: false }, true);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(false);
  });

  it('forces readonly for non-main when nonMainReadOnly=true', async () => {
    const { validateMount, dir } = await setup(true, true);
    const result = validateMount({ hostPath: dir, readonly: false }, false);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });

  it('forces readonly when root does not allow read-write', async () => {
    const { validateMount, dir } = await setup(false, false);
    const result = validateMount({ hostPath: dir, readonly: false }, true);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(true);
  });

  it('allows read-write for non-main when nonMainReadOnly=false', async () => {
    const { validateMount, dir } = await setup(true, false);
    const result = validateMount({ hostPath: dir, readonly: false }, false);
    expect(result.allowed).toBe(true);
    expect(result.effectiveReadonly).toBe(false);
  });
});

// ── validateAdditionalMounts ──────────────────────────────────────────────────

describe('validateAdditionalMounts', () => {
  it('filters out rejected mounts and returns only valid ones', async () => {
    const validDir = tmpDir();

    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            makeAllowlist({
              allowedRoots: [
                {
                  path: validDir,
                  allowReadWrite: false,
                  description: 'valid root',
                },
              ],
            }),
          ),
          realpathSync: actual.realpathSync,
        },
      };
    });
    const { validateAdditionalMounts } = await import('./mount-security.js');

    const result = validateAdditionalMounts(
      [
        { hostPath: validDir, containerPath: 'valid' },
        { hostPath: '/home/user/.ssh', containerPath: 'ssh' },
      ],
      'test-group',
      true,
    );

    expect(result).toHaveLength(1);
    expect(result[0].containerPath).toBe('/workspace/extra/valid');
    expect(result[0].hostPath).toBe(validDir);
    expect(result[0].readonly).toBe(true);
  });

  it('returns empty array when no mounts pass validation', async () => {
    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => false), // no allowlist
        },
      };
    });
    const { validateAdditionalMounts } = await import('./mount-security.js');
    const result = validateAdditionalMounts(
      [{ hostPath: '/any/path' }],
      'grp',
      true,
    );
    expect(result).toHaveLength(0);
  });

  it('uses basename as container path when not specified', async () => {
    const validDir = tmpDir();
    const basename = path.basename(validDir);

    vi.resetModules();
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        default: {
          ...actual,
          existsSync: vi.fn(() => true),
          readFileSync: vi.fn(() =>
            makeAllowlist({
              allowedRoots: [
                { path: validDir, allowReadWrite: false, description: 'root' },
              ],
            }),
          ),
          realpathSync: actual.realpathSync,
        },
      };
    });
    const { validateAdditionalMounts } = await import('./mount-security.js');
    const result = validateAdditionalMounts(
      [{ hostPath: validDir }],
      'grp',
      true,
    );
    expect(result).toHaveLength(1);
    expect(result[0].containerPath).toBe(`/workspace/extra/${basename}`);
  });
});

// ── generateAllowlistTemplate ─────────────────────────────────────────────────

describe('generateAllowlistTemplate', () => {
  it('returns valid JSON with expected structure', async () => {
    vi.resetModules();
    const { generateAllowlistTemplate } = await import('./mount-security.js');
    const json = JSON.parse(generateAllowlistTemplate());
    expect(Array.isArray(json.allowedRoots)).toBe(true);
    expect(Array.isArray(json.blockedPatterns)).toBe(true);
    expect(typeof json.nonMainReadOnly).toBe('boolean');
    expect(json.allowedRoots.length).toBeGreaterThan(0);
  });
});
