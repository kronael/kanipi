/**
 * /approve and /reject command tests.
 *
 * Uses in-memory SQLite + mocked fs to avoid touching the filesystem.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  _initTestDatabase,
  getOnboardingEntry,
  upsertOnboarding,
  getRoutesForJid,
  getGroupByFolder,
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

beforeEach(() => {
  _initTestDatabase();
  const registerGroup = vi.fn();
  setApproveDeps({ registerGroup });
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

  it('rejects already-approved jid', async () => {
    upsertOnboarding('telegram:123', {
      status: 'approved',
      world_name: 'myworld',
    });
    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch));
    expect(ch.sent[0]).toMatch(/already approved/i);
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

  it('rejects if world_name is already in groups table', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'taken',
    });
    // Insert existing group record
    const { setGroupConfig } = await import('../db.js');
    setGroupConfig({
      name: 'taken',
      folder: 'taken',
      added_at: '',
      parent: undefined,
    });

    const ch = makeChannel();
    await approveCommand.handle(makeCtx('telegram:123', ch));

    expect(ch.sent[0]).toMatch(/already in use/i);
    expect(getOnboardingEntry('telegram:123')?.status).toBe('pending');
  });
});

// ── /reject ───────────────────────────────────────────────────────────────────

describe('/reject', () => {
  it('rejects non-root callers', async () => {
    const ch = makeChannel();
    const ctx = { ...makeCtx('telegram:123', ch, 'atlas') };
    await rejectCommand.handle(ctx);
    expect(ch.sent[0]).toMatch(/root-only/i);
  });

  it('rejects unknown jid', async () => {
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('telegram:unknown', ch));
    expect(ch.sent[0]).toMatch(/no onboarding/i);
  });

  it('sets status to rejected', async () => {
    upsertOnboarding('telegram:123', {
      status: 'pending',
      world_name: 'myworld',
    });
    const ch = makeChannel();
    await rejectCommand.handle(makeCtx('telegram:123', ch));

    expect(getOnboardingEntry('telegram:123')?.status).toBe('rejected');
    expect(ch.sent[0]).toMatch(/rejected/i);
  });
});
