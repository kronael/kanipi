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

  it('returns [voice: text] on happy path', async () => {
    mockWhisper.mockResolvedValue('hello');
    const lines = await voiceHandler.handle(
      { mediaType: 'voice', mimeType: 'audio/ogg' },
      '/path/0.ogg',
    );
    expect(mockWhisper).toHaveBeenCalledWith('/path/0.ogg');
    expect(lines).toEqual(['[voice: hello]']);
  });

  it('returns [] when whisper throws', async () => {
    mockWhisper.mockRejectedValue(new Error('network error'));
    const lines = await voiceHandler.handle(
      { mediaType: 'voice' },
      '/path/0.ogg',
    );
    expect(lines).toEqual([]);
  });
});
