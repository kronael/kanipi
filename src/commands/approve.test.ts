/**
 * /approve and /reject command tests.
 *
 * Uses in-memory SQLite + mocked fs to avoid touching the filesystem.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import fs from 'fs';

import {
  _initTestDatabase,
  enqueueSystemMessage,
  getOnboardingEntry,
  upsertOnboarding,
} from '../db.js';
import approveCommand, { setApproveDeps } from './approve.js';
import rejectCommand from './reject.js';
import type { Channel, InboundEvent } from '../types.js';

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./notify.js', () => ({ notify: vi.fn() }));

// Mock fs — pass through migration reads, intercept group folder operations
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((p: string) => {
        if (String(p).includes('migrations')) return actual.existsSync(p);
        if (String(p).includes('prototype')) return true;
        return false;
      }),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn((p: string, ...rest: unknown[]) => {
        if (String(p).includes('migrations'))
          return (actual.readdirSync as Function)(p, ...rest);
        return [];
      }),
      readFileSync: vi.fn((p: string, ...rest: unknown[]) => {
        if (String(p).includes('migrations'))
          return (actual.readFileSync as Function)(p, ...rest);
        return '';
      }),
      copyFileSync: vi.fn(),
    },
  };
});

vi.mock('../group-folder.js', async () => {
  const actual =
    await vi.importActual<typeof import('../group-folder.js')>(
      '../group-folder.js',
    );
  return {
    ...actual,
    resolveGroupFolderPath: (folder: string) => `/tmp/groups/${folder}`,
  };
});

vi.mock('../config.js', () => ({
  permissionTier: (folder: string) => {
    if (folder === 'root') return 0;
    if (!folder.includes('/')) return 1;
    return 2;
  },
  GROUPS_DIR: '/tmp/groups',
}));

function makeChannel(): Channel & { sent: string[] } {
  const sent: string[] = [];
  return {
    name: 'telegram',
    sent,
    connect: vi.fn(),
    disconnect: vi.fn(),
    ownsJid: vi.fn(() => true),
    sendMessage: vi.fn(async (_jid: string, text: string) => {
      sent.push(text);
      return undefined;
    }),
  } as unknown as Channel & { sent: string[] };
}

function makeCtx(
  args: string,
  ch: Channel,
  folder = 'root',
): Parameters<typeof approveCommand.handle>[0] {
  return {
    group: { name: 'Root', folder, added_at: '', parent: undefined },
    groupJid: 'local:root',
    channel: ch,
    args,
    message: {
      id: 'msg1',
      chat_jid: 'local:root',
      sender: 'admin',
      content: `/approve ${args}`,
      timestamp: new Date().toISOString(),
    } as InboundEvent,
    clearSession: vi.fn(),
  };
}

function defaultExistsSync(p: string): boolean {
  const s = String(p);
  if (s.includes('migrations')) {
    const actual = vi.importActual<typeof import('fs')>('fs');
    return true; // handled by the mock pass-through
  }
  if (s.includes('prototype')) return true;
  return false;
}

beforeEach(() => {
  _initTestDatabase();
  setApproveDeps({ registerGroup: vi.fn(), getGroup: vi.fn(() => undefined) });
  // Reset fs.existsSync to default behaviour before each test
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const s = String(p);
    if (s.includes('prototype')) return true;
    return false;
  });
});

// ── /approve ─────────────────────────────────────────────────────────────────

describe('/approve', () => {
  it('rejects tier-2 callers', async () => {
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch, 'atlas/support'));
    expect(ch.sent[0]).toMatch(/world admin or root only/i);
  });

  it('with no args and no pending: reports none', async () => {
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('', ch));
    expect(ch.sent[0]).toMatch(/no pending/i);
  });

  it('with no args and one pending: auto-approves', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
      sender: 'Alice',
    });
    const ch = makeChannel();
    const registerGroup = vi.fn();
    setApproveDeps({ registerGroup, getGroup: vi.fn(() => undefined) });
    await approveCommand.handle(makeCtx('', ch));
    expect(ch.sent[0]).toMatch(/approved/i);
    expect(getOnboardingEntry('telegram:123')?.status).toBe('approved');
  });

  it('with no args and multiple pending: lists them', async () => {
    upsertOnboarding('telegram:1', {
      status: 'pending',
      world_name: 'alpha',
      sender: 'Alice',
    });
    upsertOnboarding('telegram:2', {
      status: 'pending',
      world_name: 'beta',
      sender: 'Bob',
    });
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('', ch));
    expect(ch.sent[0]).toMatch(/pending.*2/i);
    expect(ch.sent[0]).toMatch(/1\./);
    expect(ch.sent[0]).toMatch(/2\./);
  });

  it('approves by number', async () => {
    upsertOnboarding('telegram:1', {
      status: 'pending',
      world_name: 'alpha',
      sender: 'Alice',
    });
    upsertOnboarding('telegram:2', {
      status: 'pending',
      world_name: 'beta',
      sender: 'Bob',
    });
    const ch = makeChannel();
    const registerGroup = vi.fn();
    setApproveDeps({ registerGroup, getGroup: vi.fn(() => undefined) });
    await approveCommand.handle(makeCtx('1', ch));
    expect(ch.sent[0]).toMatch(/approved/i);
  });

  it('rejects out-of-range number', async () => {
    upsertOnboarding('telegram:1', {
      status: 'pending',
      world_name: 'alpha',
      sender: 'Alice',
    });
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('9', ch));
    expect(ch.sent[0]).toMatch(/no pending request #9/i);
  });

  it('rejects unknown jid', async () => {
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:unknown', ch));
    expect(ch.sent[0]).toMatch(/no onboarding/i);
  });

  it('re-approves an already-approved jid (override)', async () => {
    upsertOnboarding('telegram:123', {
      status: 'approved',
      world_name: 'myworld',
      sender: 'Alice',
    });
    const ch = makeChannel();
    const registerGroup = vi.fn();
    setApproveDeps({ registerGroup, getGroup: vi.fn(() => undefined) });

    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(getOnboardingEntry('telegram:123')?.status).toBe('approved');
    expect(registerGroup).toHaveBeenCalled();
    expect(ch.sent[0]).toMatch(/approved/i);
  });

  it('rejects pending entry with no world_name', async () => {
    upsertOnboarding('telegram:123', { status: 'pending' });
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch));
    expect(ch.sent[0]).toMatch(/no world name/i);
  });

  it('approves a valid pending entry', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
      sender: 'Alice',
    });
    const ch = makeChannel();
    const registerGroup = vi.fn();
    setApproveDeps({ registerGroup, getGroup: vi.fn(() => undefined) });

    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(getOnboardingEntry('telegram:123')?.status).toBe('approved');
    expect(registerGroup).toHaveBeenCalledWith(
      'telegram:123',
      expect.objectContaining({ folder: 'myworld' }),
    );
    expect(ch.sent[0]).toMatch(/approved/i);
  });

  it('reuses existing world folder when already on filesystem', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'existing',
      sender: 'Alice',
    });
    vi.mocked(fs.existsSync).mockImplementation(() => true); // prototype + world both exist

    const ch = makeChannel();
    const registerGroup = vi.fn();
    setApproveDeps({ registerGroup, getGroup: vi.fn(() => undefined) });
    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(ch.sent[0]).toMatch(/approved/i);
    expect(getOnboardingEntry('telegram:123')?.status).toBe('approved');
    expect(registerGroup).toHaveBeenCalled();
    // copyDirRecursive should NOT have been called (world folder already exists)
    expect(fs.mkdirSync).not.toHaveBeenCalledWith(
      expect.stringContaining('existing'),
      expect.anything(),
    );
  });

  it('rejects when prototype directory is missing', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'newworld',
    });
    vi.mocked(fs.existsSync).mockImplementation(() => false);

    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(ch.sent[0]).toMatch(/no prototype/i);
    expect(getOnboardingEntry('telegram:123')?.status).toBe('pending');
  });

  it('system message contains user jid, group folder, and instructions', async () => {
    const enqueueSpy = vi.spyOn(
      await import('../db.js'),
      'enqueueSystemMessage',
    );
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
      sender: 'Alice',
    });
    const ch = makeChannel();
    setApproveDeps({
      registerGroup: vi.fn(),
      getGroup: vi.fn(() => undefined),
    });
    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(enqueueSpy).toHaveBeenCalledWith(
      'myworld',
      expect.objectContaining({
        body: expect.stringContaining('jid="telegram:123"'),
      }),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      'myworld',
      expect.objectContaining({
        body: expect.stringContaining('folder="myworld"'),
      }),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      'myworld',
      expect.objectContaining({
        body: expect.stringContaining('<instructions>'),
      }),
    );
    enqueueSpy.mockRestore();
  });
});

it('world admin: admits into own world without target', async () => {
  upsertOnboarding('telegram:123', {
    status: 'pending',
    sender: 'Alice',
  });
  const ch = makeChannel();
  const registerGroup = vi.fn();
  const existingGroup = {
    name: 'atlas',
    folder: 'atlas',
    added_at: '',
    parent: undefined,
  };
  setApproveDeps({ registerGroup, getGroup: vi.fn(() => existingGroup) });
  await approveCommand.handle(makeCtx('telegram:123', ch, 'atlas'));
  expect(ch.sent[0]).toMatch(/approved.*atlas/i);
  expect(registerGroup).toHaveBeenCalledWith('telegram:123', existingGroup);
});

it('world admin: cannot approve into another world', async () => {
  upsertOnboarding('telegram:123', { status: 'pending', sender: 'Alice' });
  const ch = makeChannel();
  setApproveDeps({ registerGroup: vi.fn(), getGroup: vi.fn(() => undefined) });
  await approveCommand.handle(makeCtx('telegram:123 otherworld', ch, 'atlas'));
  expect(ch.sent[0]).toMatch(/own world/i);
});

// ── /reject ───────────────────────────────────────────────────────────────────

describe('/reject', () => {
  it('rejects tier-2 callers', async () => {
    const ch = makeChannel();
    await rejectCommand.handle({
      ...makeCtx('telegram:123', ch, 'atlas/support'),
    });
    expect(ch.sent[0]).toMatch(/world admin or root only/i);
  });

  it('with no args and no pending: reports none', async () => {
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('', ch));
    expect(ch.sent[0]).toMatch(/no pending/i);
  });

  it('rejects unknown jid', async () => {
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('telegram:unknown', ch));
    expect(ch.sent[0]).toMatch(/no onboarding/i);
  });

  it('sets status to rejected for pending entry', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
    });
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('telegram:123', ch));

    expect(getOnboardingEntry('telegram:123')?.status).toBe('rejected');
    expect(ch.sent[0]).toMatch(/rejected/i);
  });

  it('can reject a new entry (no world_name yet)', async () => {
    upsertOnboarding('telegram:123', { status: 'new' });
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('telegram:123', ch));

    expect(getOnboardingEntry('telegram:123')?.status).toBe('rejected');
  });

  it('is idempotent — rejecting an already-rejected entry succeeds', async () => {
    upsertOnboarding('telegram:123', { status: 'rejected' });
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('telegram:123', ch));

    expect(getOnboardingEntry('telegram:123')?.status).toBe('rejected');
    expect(ch.sent[0]).toMatch(/rejected/i);
  });
});
