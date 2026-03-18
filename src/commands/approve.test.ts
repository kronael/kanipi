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
  permissionTier: (folder: string) => (folder === 'root' ? 0 : 1),
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
  setApproveDeps({ registerGroup: vi.fn() });
  // Reset fs.existsSync to default behaviour before each test
  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const s = String(p);
    if (s.includes('prototype')) return true;
    return false;
  });
});

// ── /approve ─────────────────────────────────────────────────────────────────

describe('/approve', () => {
  it('rejects non-root callers', async () => {
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch, 'atlas'));
    expect(ch.sent[0]).toMatch(/root-only/i);
  });

  it('requires a jid argument', async () => {
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('', ch));
    expect(ch.sent[0]).toMatch(/usage/i);
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
    setApproveDeps({ registerGroup });

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
    setApproveDeps({ registerGroup });

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
    setApproveDeps({ registerGroup });
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

  it('completes without crashing when deps is null', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
      sender: 'Alice',
    });
    setApproveDeps(null as unknown as Parameters<typeof setApproveDeps>[0]);

    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch));

    // Status still updated and reply still sent despite null deps
    expect(getOnboardingEntry('telegram:123')?.status).toBe('approved');
    expect(ch.sent[0]).toMatch(/approved/i);
  });

  it('uses jid as userId when message.sender is missing', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
      sender: 'Alice',
    });
    const ch = makeChannel();
    const registerGroup = vi.fn();
    setApproveDeps({ registerGroup });

    const ctx = makeCtx('telegram:123', ch);
    (ctx.message as Record<string, unknown>).sender = undefined;
    await approveCommand.handle(ctx);

    expect(registerGroup).toHaveBeenCalledWith(
      'telegram:123',
      expect.objectContaining({ folder: 'myworld' }),
    );
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
    setApproveDeps({ registerGroup: vi.fn() });
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

  it('GroupConfig has ISO 8601 added_at timestamp', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
    });
    const ch = makeChannel();
    let capturedConfig: Parameters<
      typeof setApproveDeps
    >[0]['registerGroup'] extends (jid: string, group: infer G) => void
      ? G
      : never;
    setApproveDeps({
      registerGroup: (_jid, group) => {
        capturedConfig = group as typeof capturedConfig;
      },
    });

    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(capturedConfig!.added_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── /reject ───────────────────────────────────────────────────────────────────

describe('/reject', () => {
  it('rejects non-root callers', async () => {
    const ch = makeChannel();
    await rejectCommand.handle({ ...makeCtx('telegram:123', ch, 'atlas') });
    expect(ch.sent[0]).toMatch(/root-only/i);
  });

  it('requires a jid argument', async () => {
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('', ch));
    expect(ch.sent[0]).toMatch(/usage/i);
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

  it('can reject an already-approved entry', async () => {
    upsertOnboarding('telegram:123', {
      status: 'approved',
      world_name: 'myworld',
    });
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
