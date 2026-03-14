import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

let videoEnabled = true;

const { mockWhisper, mockSpawn } = vi.hoisted(() => ({
  mockWhisper: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock('../config.js', () => ({
  get VIDEO_TRANSCRIPTION_ENABLED() {
    return videoEnabled;
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

vi.mock('child_process', () => ({ spawn: mockSpawn }));

function makeProc(exitCode: number) {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
  proc.stderr = new EventEmitter();
  setTimeout(() => proc.emit('close', exitCode), 0);
  return proc;
}

import { videoHandler } from './video.js';

beforeEach(() => {
  vi.resetAllMocks();
  videoEnabled = true;
  mockSpawn.mockReturnValue(makeProc(0));
});

// --- match ---

describe('videoHandler.match', () => {
  it('matches mediaType video', () => {
    expect(videoHandler.match({ mediaType: 'video' })).toBe(true);
  });

  it('matches mimeType video/mp4', () => {
    expect(
      videoHandler.match({ mediaType: 'document', mimeType: 'video/mp4' }),
    ).toBe(true);
  });

  it('does not match audio', () => {
    expect(
      videoHandler.match({ mediaType: 'audio', mimeType: 'audio/ogg' }),
    ).toBe(false);
  });
});

// --- handle ---

describe('videoHandler.handle', () => {
  it('returns [] when transcription disabled', async () => {
    videoEnabled = false;
    const lines = await videoHandler.handle(
      { mediaType: 'video' },
      '/path/0.mp4',
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('spawns ffmpeg and returns [video audio: text]', async () => {
    mockWhisper.mockResolvedValue({ text: 'hello', language: 'en' });
    const lines = await videoHandler.handle(
      { mediaType: 'video', mimeType: 'video/mp4' },
      '/path/0.mp4',
    );
    expect(mockSpawn).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-i', '/path/0.mp4']),
    );
    expect(mockWhisper).toHaveBeenCalledWith('/path/0-audio.aac');
    expect(lines).toEqual(['[video audio: hello]']);
  });

  it('returns [] when ffmpeg exits non-zero', async () => {
    mockSpawn.mockReturnValue(makeProc(1));
    const lines = await videoHandler.handle(
      { mediaType: 'video' },
      '/path/0.mp4',
    );
    expect(lines).toEqual([]);
  });

  it('returns [] when whisper throws', async () => {
    mockWhisper.mockRejectedValue(new Error('no model'));
    const lines = await videoHandler.handle(
      { mediaType: 'video' },
      '/path/0.mp4',
    );
    expect(lines).toEqual([]);
  });

  it('returns [] when ffmpeg spawn emits error (e.g. not found)', async () => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    proc.stderr = new EventEmitter();
    setTimeout(() => proc.emit('error', new Error('ENOENT')), 0);
    mockSpawn.mockReturnValue(proc);
    const lines = await videoHandler.handle(
      { mediaType: 'video' },
      '/path/0.mp4',
    );
    expect(lines).toEqual([]);
  });

  it('does not match image mediaType', () => {
    expect(videoHandler.match({ mediaType: 'image' })).toBe(false);
  });

  it('does not match audio mimeType', () => {
    expect(
      videoHandler.match({ mediaType: 'document', mimeType: 'audio/mp3' }),
    ).toBe(false);
  });

  it('kills ffmpeg and returns [] after 60s timeout', async () => {
    vi.useFakeTimers();
    const proc = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    mockSpawn.mockReturnValue(proc);
    mockWhisper.mockResolvedValue('irrelevant');

    const p = videoHandler.handle({ mediaType: 'video' }, '/path/0.mp4');
    await vi.advanceTimersByTimeAsync(60_000);
    const lines = await p;
    expect(proc.kill).toHaveBeenCalled();
    expect(lines).toEqual([]);
    vi.useRealTimers();
  });
});
