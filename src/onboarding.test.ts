/**
 * Onboarding state machine tests.
 *
 * Tests handleOnboarding() transitions and isValidWorldName().
 * Uses an in-memory SQLite DB via _initTestDatabase() — no Docker needed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  _initTestDatabase,
  getOnboardingEntry,
  upsertOnboarding,
} from './db.js';
import { handleOnboarding, isValidWorldName } from './onboarding.js';
import type { Channel, InboundEvent } from './types.js';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./commands/notify.js', () => ({ notify: vi.fn() }));

function makeMsg(content: string, jid = 'telegram:123'): InboundEvent {
  return {
    id: `msg-${Math.random()}`,
    chat_jid: jid,
    sender: 'user1',
    sender_name: 'Alice',
    content,
    timestamp: new Date().toISOString(),
  };
}

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

beforeEach(() => {
  _initTestDatabase();
});

// ── isValidWorldName ──────────────────────────────────────────────────────────

describe('isValidWorldName', () => {
  it('accepts simple lowercase names', () => {
    expect(isValidWorldName('alice')).toBe(true);
    expect(isValidWorldName('my-world')).toBe(true);
    expect(isValidWorldName('foo123')).toBe(true);
  });

  it('rejects names starting with a hyphen', () => {
    expect(isValidWorldName('-foo')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidWorldName('Alice')).toBe(false);
  });

  it('rejects names over 63 chars', () => {
    expect(isValidWorldName('a'.repeat(64))).toBe(false);
    expect(isValidWorldName('a'.repeat(63))).toBe(true);
  });

  it('rejects reserved names', () => {
    expect(isValidWorldName('root')).toBe(false);
    expect(isValidWorldName('local')).toBe(false);
    expect(isValidWorldName('share')).toBe(false);
  });
});

// ── handleOnboarding state machine ───────────────────────────────────────────

describe('handleOnboarding', () => {
  const jid = 'telegram:999';

  it('creates new entry and sends welcome on first contact', async () => {
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('hello', jid)], ch);

    const entry = getOnboardingEntry(jid);
    expect(entry?.status).toBe('new');
    expect(ch.sent[0]).toMatch(/\/request/);
  });

  it('prompts for /request when status is new and no command sent', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('what do I do?', jid)], ch);

    expect(ch.sent[0]).toMatch(/\/request/);
    expect(getOnboardingEntry(jid)?.status).toBe('new');
  });

  it('transitions new → pending on valid /request', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('/request myworld', jid)], ch);

    const entry = getOnboardingEntry(jid);
    expect(entry?.status).toBe('pending');
    expect(entry?.world_name).toBe('myworld');
    expect(ch.sent[0]).toMatch(/waiting/i);
  });

  it('rejects invalid world name and stays in new', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('/request Root', jid)], ch);

    expect(getOnboardingEntry(jid)?.status).toBe('new');
    expect(ch.sent[0]).toMatch(/invalid/i);
  });

  it('rejects reserved world name', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('/request root', jid)], ch);

    expect(getOnboardingEntry(jid)?.status).toBe('new');
    expect(ch.sent[0]).toMatch(/invalid/i);
  });

  it('tells pending users to wait', async () => {
    upsertOnboarding(jid, { status: 'pending', world_name: 'myworld' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('any message', jid)], ch);

    expect(ch.sent[0]).toMatch(/waiting/i);
    expect(getOnboardingEntry(jid)?.status).toBe('pending');
  });

  it('notifies rejected users', async () => {
    upsertOnboarding(jid, { status: 'rejected' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('hello again', jid)], ch);

    expect(ch.sent[0]).toMatch(/not approved/i);
  });

  it('silently ignores approved users (already routed)', async () => {
    upsertOnboarding(jid, { status: 'approved' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('hello', jid)], ch);

    expect(ch.sent).toHaveLength(0);
  });

  it('/request is case-insensitive for the command', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('/REQUEST myworld', jid)], ch);

    expect(getOnboardingEntry(jid)?.status).toBe('pending');
  });

  it('returns early and sends nothing on empty messages array', async () => {
    const ch = makeChannel();
    await handleOnboarding(jid, [], ch);

    expect(ch.sent).toHaveLength(0);
    expect(getOnboardingEntry(jid)).toBeUndefined();
  });

  it('stores unknown as sender fallback when both sender fields are null/undefined', async () => {
    const msg = {
      id: 'msg-x',
      chat_jid: jid,
      sender: undefined as unknown as string,
      sender_name: undefined,
      content: 'hello',
      timestamp: new Date().toISOString(),
    } as InboundEvent;
    const ch = makeChannel();
    await handleOnboarding(jid, [msg], ch);

    expect(getOnboardingEntry(jid)?.sender).toBe('unknown');
  });

  it('/request with multiple spaces still extracts first token', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('/request  myworld', jid)], ch);

    expect(getOnboardingEntry(jid)?.world_name).toBe('myworld');
    expect(getOnboardingEntry(jid)?.status).toBe('pending');
  });

  it('/request stops at first space — only first word used as name', async () => {
    upsertOnboarding(jid, { status: 'new' });
    const ch = makeChannel();
    // "my" is a valid name; only "my" is extracted, "world" is ignored
    await handleOnboarding(jid, [makeMsg('/request my world', jid)], ch);

    const entry = getOnboardingEntry(jid);
    expect(entry?.world_name).toBe('my');
    expect(entry?.status).toBe('pending');
  });

  it('logs warning for unknown onboarding status', async () => {
    const { logger } = await import('./logger.js');
    // Directly set an invalid status in DB via raw upsert then override
    upsertOnboarding(jid, { status: 'new' });
    // Force an unexpected status by upserting a non-standard value
    const { getDatabase } = await import('./db.js');
    getDatabase()
      .prepare("UPDATE onboarding SET status = 'bogus' WHERE jid = ?")
      .run(jid);

    const ch = makeChannel();
    await handleOnboarding(jid, [makeMsg('hello', jid)], ch);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'bogus' }),
      'Unknown onboarding status',
    );
    expect(ch.sent).toHaveLength(0);
  });
});
