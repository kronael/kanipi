import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Config ─────────────────────────────────────────────────────────────────

let mediaEnabled = true;

vi.mock('./config.js', () => ({
  get MEDIA_ENABLED() {
    return mediaEnabled;
  },
  GROUPS_DIR: '/srv/groups',
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

// ── DB ─────────────────────────────────────────────────────────────────────

const { mockAppend } = vi.hoisted(() => ({ mockAppend: vi.fn() }));

vi.mock('./db.js', () => ({
  appendMessageContent: mockAppend,
}));

// ── Mime pipeline ──────────────────────────────────────────────────────────

const { mockProcess } = vi.hoisted(() => ({ mockProcess: vi.fn() }));

vi.mock('./mime.js', () => ({
  toAttachment: (a: unknown) => a,
  makeDownloader: vi.fn(() => vi.fn()),
  processAttachments: mockProcess,
}));

vi.mock('./mime-handlers/voice.js', () => ({ voiceHandler: {} }));
vi.mock('./mime-handlers/video.js', () => ({ videoHandler: {} }));

// ── Subject ────────────────────────────────────────────────────────────────

import { enqueueEnrichment, waitForEnrichments } from './mime-enricher.js';

const attachment = { mediaType: 'voice', mimeType: 'audio/ogg' } as never;
const download = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  mediaEnabled = true;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('enqueueEnrichment', () => {
  it('does nothing when MEDIA_ENABLED is false', async () => {
    mediaEnabled = false;
    enqueueEnrichment('m1', 'root', [attachment], download);
    await waitForEnrichments(['m1']);
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it('calls appendMessageContent when pipeline returns lines', async () => {
    mockProcess.mockResolvedValue(['[voice/auto→en: hello]']);
    enqueueEnrichment('m1', 'root', [attachment], download);
    await waitForEnrichments(['m1']);
    expect(mockAppend).toHaveBeenCalledWith('m1', '\n[voice/auto→en: hello]');
  });

  it('does not call appendMessageContent when pipeline returns empty lines', async () => {
    mockProcess.mockResolvedValue([]);
    enqueueEnrichment('m1', 'root', [attachment], download);
    await waitForEnrichments(['m1']);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('swallows pipeline errors without throwing', async () => {
    mockProcess.mockRejectedValue(new Error('whisper down'));
    enqueueEnrichment('m1', 'root', [attachment], download);
    await expect(waitForEnrichments(['m1'])).resolves.toBeUndefined();
  });
});

describe('waitForEnrichments', () => {
  it('resolves immediately when no enrichments are pending', async () => {
    await expect(waitForEnrichments(['unknown-id'])).resolves.toBeUndefined();
  });

  it('waits for in-flight enrichment before resolving', async () => {
    let resolve!: () => void;
    mockProcess.mockReturnValue(
      new Promise<string[]>((r) => {
        resolve = () => r(['[voice/auto→en: text]']);
      }),
    );

    enqueueEnrichment('m2', 'root', [attachment], download);

    let done = false;
    const waiter = waitForEnrichments(['m2']).then(() => {
      done = true;
    });

    // Not yet done — enrichment still running
    await Promise.resolve();
    expect(done).toBe(false);

    resolve();
    await waiter;
    expect(done).toBe(true);
    expect(mockAppend).toHaveBeenCalledWith('m2', '\n[voice/auto→en: text]');
  });

  it('waits for multiple in-flight enrichments', async () => {
    let resolve1!: () => void;
    let resolve2!: () => void;
    mockProcess
      .mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolve1 = () => r(['[voice/auto→en: first]']);
        }),
      )
      .mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolve2 = () => r(['[voice/auto→en: second]']);
        }),
      );

    enqueueEnrichment('multi1', 'root', [attachment], download);
    enqueueEnrichment('multi2', 'root', [attachment], download);

    let done = false;
    const waiter = waitForEnrichments(['multi1', 'multi2']).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);

    resolve1();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);

    resolve2();
    await waiter;
    expect(done).toBe(true);
    expect(mockAppend).toHaveBeenCalledTimes(2);
  });

  it('handles mix of pending and unknown ids', async () => {
    mockProcess.mockResolvedValue(['[voice/auto→en: text]']);
    enqueueEnrichment('mix1', 'root', [attachment], download);
    // 'unknown-id' has no pending enrichment — should not block
    await expect(
      waitForEnrichments(['mix1', 'unknown-id']),
    ).resolves.toBeUndefined();
  });

  it('resolves immediately if enrichment already completed (race: fast whisper)', async () => {
    mockProcess.mockResolvedValue(['[voice/auto→cs: ahoj]']);
    enqueueEnrichment('m3', 'root', [attachment], download);

    // Let the microtask queue drain so the enrichment promise settles
    await Promise.resolve();
    await Promise.resolve();

    // At this point the enrichment has completed and been removed from pending.
    // waitForEnrichments should return immediately (enrichment already wrote to DB).
    await expect(waitForEnrichments(['m3'])).resolves.toBeUndefined();
    expect(mockAppend).toHaveBeenCalledWith('m3', '\n[voice/auto→cs: ahoj]');
  });
});
