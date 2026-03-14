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

  it('passes language parameter in form data', async () => {
    let formBody: FormData | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      formBody = opts.body;
      return Promise.resolve({
        ok: true,
        json: async () => ({ text: 'ahoj', language: 'cs' }),
      });
    });

    const result = await whisperTranscribe('/tmp/audio.ogg', 'cs');
    expect(result).toEqual({ text: 'ahoj', language: 'cs' });
    expect(formBody).toBeInstanceOf(FormData);
    expect(formBody!.get('language')).toBe('cs');
  });

  it('does not include language in form data when undefined', async () => {
    let formBody: FormData | undefined;
    global.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      formBody = opts.body;
      return Promise.resolve({
        ok: true,
        json: async () => ({ text: 'hello', language: 'en' }),
      });
    });

    await whisperTranscribe('/tmp/audio.ogg');
    expect(formBody!.get('language')).toBeNull();
  });

  it('defaults language to "unknown" when response has no language', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'hello' }),
    } as Response);

    const result = await whisperTranscribe('/tmp/audio.ogg');
    expect(result.language).toBe('unknown');
  });

  it('defaults text to empty string when response has no text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ language: 'en' }),
    } as Response);

    const result = await whisperTranscribe('/tmp/audio.ogg');
    expect(result.text).toBe('');
  });

  it('uses forced language as fallback when response language is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'test' }),
    } as Response);

    const result = await whisperTranscribe('/tmp/audio.ogg', 'de');
    expect(result.language).toBe('de');
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
