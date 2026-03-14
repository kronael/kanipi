import { describe, it, expect, vi, beforeEach } from 'vitest';

let voiceEnabled = true;

const { mockWhisper } = vi.hoisted(() => ({ mockWhisper: vi.fn() }));

vi.mock('../config.js', () => ({
  get VOICE_TRANSCRIPTION_ENABLED() {
    return voiceEnabled;
  },
}));

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, writeFileSync: vi.fn() },
  };
});

vi.mock('./whisper.js', () => ({
  whisperTranscribe: mockWhisper,
}));

import { voiceHandler } from './voice.js';

beforeEach(() => {
  vi.resetAllMocks();
  voiceEnabled = true;
});

// --- match ---

describe('voiceHandler.match', () => {
  it('matches mediaType voice', () => {
    expect(voiceHandler.match({ mediaType: 'voice' })).toBe(true);
  });

  it('matches mediaType audio', () => {
    expect(voiceHandler.match({ mediaType: 'audio' })).toBe(true);
  });

  it('matches mimeType audio/ogg', () => {
    expect(
      voiceHandler.match({ mediaType: 'document', mimeType: 'audio/ogg' }),
    ).toBe(true);
  });

  it('does not match image', () => {
    expect(
      voiceHandler.match({ mediaType: 'image', mimeType: 'image/jpeg' }),
    ).toBe(false);
  });

  it('does not match document with video mimeType', () => {
    expect(
      voiceHandler.match({ mediaType: 'document', mimeType: 'video/mp4' }),
    ).toBe(false);
  });

  it('does not match video mediaType', () => {
    expect(voiceHandler.match({ mediaType: 'video' })).toBe(false);
  });
});

// --- handle ---

describe('voiceHandler.handle', () => {
  it('returns [] when transcription disabled', async () => {
    voiceEnabled = false;
    const lines = await voiceHandler.handle(
      { mediaType: 'voice' },
      '/path/0.ogg',
    );
    expect(mockWhisper).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('returns [voice/auto→en: text] on happy path (no language config)', async () => {
    mockWhisper.mockResolvedValue({ text: 'hello', language: 'en' });
    const lines = await voiceHandler.handle(
      { mediaType: 'voice', mimeType: 'audio/ogg' },
      '/path/0.ogg',
    );
    // auto-detect pass only (no .whisper-language file in /path/)
    expect(mockWhisper).toHaveBeenCalledWith('/path/0.ogg', undefined);
    expect(lines).toEqual(['[voice/auto→en: hello]']);
  });

  it('returns [] when whisper returns empty text', async () => {
    mockWhisper.mockResolvedValue({ text: '', language: 'en' });
    const lines = await voiceHandler.handle(
      { mediaType: 'voice' },
      '/path/0.ogg',
    );
    expect(lines).toEqual([]);
  });

  it('handles multi-language passes with .whisper-language file', async () => {
    // Simulate .whisper-language file by mocking fs.readFileSync
    const fs = await import('fs');
    vi.spyOn(fs.default, 'readFileSync').mockReturnValue('cs\nen\n');

    // auto-detect + cs + en = 3 calls
    mockWhisper
      .mockResolvedValueOnce({ text: 'auto result', language: 'en' })
      .mockResolvedValueOnce({ text: 'czech result', language: 'cs' })
      .mockResolvedValueOnce({ text: 'english result', language: 'en' });

    const lines = await voiceHandler.handle(
      { mediaType: 'voice' },
      '/groups/root/media/20260314/msg1/0.ogg',
    );

    expect(mockWhisper).toHaveBeenCalledTimes(3);
    expect(mockWhisper).toHaveBeenCalledWith(
      '/groups/root/media/20260314/msg1/0.ogg',
      undefined,
    );
    expect(mockWhisper).toHaveBeenCalledWith(
      '/groups/root/media/20260314/msg1/0.ogg',
      'cs',
    );
    expect(mockWhisper).toHaveBeenCalledWith(
      '/groups/root/media/20260314/msg1/0.ogg',
      'en',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('voice/auto');
    expect(lines[0]).toContain('voice/cs');
    expect(lines[0]).toContain('voice/en');
  });

  it('partial failure: auto-detect fails but forced language succeeds', async () => {
    const fs = await import('fs');
    vi.spyOn(fs.default, 'readFileSync').mockReturnValue('cs\n');

    mockWhisper
      .mockRejectedValueOnce(new Error('auto failed'))
      .mockResolvedValueOnce({ text: 'czech text', language: 'cs' });

    const lines = await voiceHandler.handle(
      { mediaType: 'voice' },
      '/groups/root/media/20260314/msg1/0.ogg',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('voice/cs');
    expect(lines[0]).not.toContain('auto');
  });

  it('returns [] when all whisper passes throw', async () => {
    mockWhisper.mockRejectedValue(new Error('network error'));
    const lines = await voiceHandler.handle(
      { mediaType: 'voice' },
      '/path/0.ogg',
    );
    expect(lines).toEqual([]);
  });
});
