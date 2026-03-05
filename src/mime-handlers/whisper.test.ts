import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  WHISPER_BASE_URL: 'http://localhost:8080',
  WHISPER_MODEL: 'turbo',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn().mockReturnValue(Buffer.from('audio')),
    },
  };
});

import { whisperTranscribe } from './whisper.js';

beforeEach(() => {
  vi.resetAllMocks();
  // re-apply readFileSync mock after reset
  const fs = require('fs');
  vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('audio'));
});

describe('whisperTranscribe', () => {
  it('posts to /inference and returns trimmed text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '  hello world  ', language: 'en' }),
    } as Response);

    const result = await whisperTranscribe('/tmp/audio.ogg');
    expect(result).toEqual({ text: 'hello world', language: 'en' });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/inference',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal server error',
    } as unknown as Response);

    await expect(whisperTranscribe('/tmp/audio.ogg')).rejects.toThrow(
      'whisper HTTP 500',
    );
  });

  it('aborts fetch after 60s', async () => {
    vi.useFakeTimers();
    let aborted = false;
    global.fetch = vi
      .fn()
      .mockImplementation((_url: string, opts: RequestInit) => {
        (opts.signal as AbortSignal).addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise(() => {}); // never resolves
      });
    whisperTranscribe('/path/audio.ogg');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(aborted).toBe(true);
    vi.useRealTimers();
  });
});
