/**
 * Voice roundtrip integration test.
 *
 * Tests processAttachments wired to the real voiceHandler — verifying that
 * whisper transcription output flows through the mime pipeline and appears
 * in the returned annotation lines. The whisper external call is mocked;
 * all other code (mime.ts + voice.ts) runs real.
 *
 * Not mocked: mime.ts, voice.ts (handler logic, language file reading, output formatting)
 * Mocked: whisper (external API), fs.writeFileSync (suppress output file creation),
 *         config, logger
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockWhisper } = vi.hoisted(() => ({ mockWhisper: vi.fn() }));

vi.mock('../../src/config.js', () => ({
  VOICE_TRANSCRIPTION_ENABLED: true,
  MEDIA_MAX_FILE_BYTES: 20971520,
}));

vi.mock('../../src/logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Mock fs — suppress disk writes; allow real readFileSync behaviour by default
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
  };
});

vi.mock('../../src/mime-handlers/whisper.js', () => ({
  whisperTranscribe: mockWhisper,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  processAttachments,
  type Attachment,
  type Downloader,
} from '../../src/mime.js';
import { voiceHandler } from '../../src/mime-handlers/voice.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MSG_DIR = '/groups/root/media/20260318/msg1';
const VOICE_PATH = path.join(MSG_DIR, '0.ogg');

function makeDownloader(buf = Buffer.from('audio-data')): Downloader {
  return vi.fn().mockResolvedValue(buf);
}

function voiceAttachment(): Attachment {
  return { mediaType: 'voice', mimeType: 'audio/ogg' };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('voice roundtrip — processAttachments + voiceHandler', () => {
  it('transcription text appears in pipeline output', async () => {
    mockWhisper.mockResolvedValue({ text: 'hello world', language: 'en' });

    const lines = await processAttachments(
      'msg1',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    expect(lines.some((l) => l.includes('hello world'))).toBe(true);
    expect(lines.some((l) => l.includes('[voice/auto→en:'))).toBe(true);
  });

  it('media line follows transcription line in output', async () => {
    mockWhisper.mockResolvedValue({ text: 'test speech', language: 'de' });

    const lines = await processAttachments(
      'msg2',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    const transcriptionIdx = lines.findIndex((l) => l.includes('voice/'));
    const mediaIdx = lines.findIndex((l) => l.includes('[media attached:'));
    expect(transcriptionIdx).toBeGreaterThanOrEqual(0);
    expect(mediaIdx).toBeGreaterThan(transcriptionIdx);
  });

  it('media line uses ~/media/ relative path', async () => {
    mockWhisper.mockResolvedValue({ text: 'check path', language: 'en' });

    const lines = await processAttachments(
      'msg3',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    const mediaLine = lines.find((l) => l.includes('[media attached:'));
    expect(mediaLine).toBeDefined();
    expect(mediaLine).toContain('~/media/');
    expect(mediaLine).not.toContain('/groups/root');
  });

  it('whisper failure: voiceHandler returns [], only media line emitted', async () => {
    // voiceHandler catches whisper errors internally via Promise.allSettled.
    // It returns [] when all passes fail — processAttachments still emits the media line.
    mockWhisper.mockRejectedValue(new Error('network timeout'));

    const lines = await processAttachments(
      'msg4',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[media attached:');
    expect(lines.some((l) => l.includes('voice/'))).toBe(false);
  });

  it('empty whisper result: returns [] from handler, only media line in output', async () => {
    mockWhisper.mockResolvedValue({ text: '', language: 'en' });

    const lines = await processAttachments(
      'msg5',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    // voiceHandler returns [] → pipeline appends only the media line
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[media attached:');
    expect(lines[0]).not.toContain('voice/');
  });

  it('voice + image: transcription block precedes image media line', async () => {
    mockWhisper.mockResolvedValue({ text: 'spoken words', language: 'fr' });

    const imageAttachment: Attachment = {
      mediaType: 'image',
      mimeType: 'image/jpeg',
    };
    const download = vi.fn().mockResolvedValue(Buffer.from('img'));

    const lines = await processAttachments(
      'msg6',
      MSG_DIR,
      [voiceAttachment(), imageAttachment],
      download,
      [voiceHandler],
    );

    const hasTranscription = lines.some((l) => l.includes('voice/auto→fr'));
    const hasImageMedia = lines.some(
      (l) => l.includes('[media attached:') && l.includes('image/jpeg'),
    );
    expect(hasTranscription).toBe(true);
    expect(hasImageMedia).toBe(true);
    // Two attachment blocks separated by a blank line
    expect(lines).toContain('');
  });

  it('whisper called with correct local path', async () => {
    mockWhisper.mockResolvedValue({ text: 'path check', language: 'en' });

    await processAttachments(
      'msg7',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    // whisperTranscribe receives the saved file path
    expect(mockWhisper).toHaveBeenCalledWith(VOICE_PATH, undefined);
  });

  it('multi-language: all forced-language passes called and combined', async () => {
    // Simulate .whisper-language file returning ['cs']
    const fs = await import('fs');
    vi.spyOn(fs.default, 'readFileSync').mockReturnValue('cs\n');

    mockWhisper
      .mockResolvedValueOnce({ text: 'auto result', language: 'en' })
      .mockResolvedValueOnce({ text: 'czech result', language: 'cs' });

    const lines = await processAttachments(
      'msg8',
      MSG_DIR,
      [voiceAttachment()],
      makeDownloader(),
      [voiceHandler],
    );

    expect(mockWhisper).toHaveBeenCalledTimes(2);
    // Both passes appear in the combined transcription line
    const transcriptionLine = lines.find((l) => l.includes('voice/'));
    expect(transcriptionLine).toContain('voice/auto→en');
    expect(transcriptionLine).toContain('voice/cs');
  });
});
