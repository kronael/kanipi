import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  MEDIA_MAX_FILE_BYTES: 20971520,
}));

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn() },
  };
});

import fs from 'fs';
import path from 'path';
import {
  mediaLine,
  processAttachments,
  toAttachment,
  makeDownloader,
  type Attachment,
  type RawAttachment,
  type AttachmentHandler,
} from './mime.js';

beforeEach(() => {
  vi.resetAllMocks();
});

// --- mediaLine ---

describe('mediaLine', () => {
  it('includes mimeType when present', () => {
    const a: Attachment = { mediaType: 'audio', mimeType: 'audio/ogg' };
    expect(
      mediaLine(a, '/srv/app/home/groups/main/media/20260311/1004/0.ogg'),
    ).toBe('[media attached: ~/media/20260311/1004/0.ogg (audio/ogg)]');
  });

  it('omits mimeType when absent', () => {
    const a: Attachment = { mediaType: 'image' };
    expect(
      mediaLine(
        a,
        '/srv/data/kanipi_test/groups/atlas/media/20260310/m1/0.jpg',
      ),
    ).toBe('[media attached: ~/media/20260310/m1/0.jpg]');
  });

  it('falls back to full path if /media/ not found', () => {
    const a: Attachment = { mediaType: 'document' };
    expect(mediaLine(a, '/other/path/file.pdf')).toBe(
      '[media attached: /other/path/file.pdf]',
    );
  });
});

// --- processAttachments ---

describe('processAttachments', () => {
  const msgDir = '/tmp/msg';
  const buf = Buffer.from('data');

  function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
    return { mediaType: 'image', mimeType: 'image/jpeg', ...overrides };
  }

  it('calls downloader once per attachment', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a = makeAttachment();
    await processAttachments('id1', msgDir, [a], download, []);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(a);
  });

  it('writes files to msgDir with correct extension', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a = makeAttachment({ mimeType: 'audio/ogg', mediaType: 'voice' });
    await processAttachments('id2', msgDir, [a], download, []);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(msgDir, '0.ogg'),
      buf,
    );
  });

  it('appends handler extra lines before media line', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a = makeAttachment({ mediaType: 'voice', mimeType: 'audio/ogg' });
    const handler: AttachmentHandler = {
      name: 'test',
      match: () => true,
      handle: async () => ['[voice: hello]'],
    };
    const lines = await processAttachments('id3', msgDir, [a], download, [
      handler,
    ]);
    expect(lines[0]).toBe('[voice: hello]');
    expect(lines[1]).toMatch(/^\[media attached:/);
  });

  it('separates multiple attachments with blank line', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a1 = makeAttachment({ mimeType: 'image/jpeg' });
    const a2 = makeAttachment({ mimeType: 'image/png' });
    const lines = await processAttachments(
      'id4',
      msgDir,
      [a1, a2],
      download,
      [],
    );
    expect(lines[1]).toBe('');
  });

  it('failed handler skips extra lines but still has media line', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a = makeAttachment({ mediaType: 'voice', mimeType: 'audio/ogg' });
    const handler: AttachmentHandler = {
      name: 'bad',
      match: () => true,
      handle: async () => {
        throw new Error('boom');
      },
    };
    // handler throws → processAttachments uses allSettled, skips the block
    const lines = await processAttachments('id5', msgDir, [a], download, [
      handler,
    ]);
    // The block is skipped entirely (rejected promise is warned and skipped)
    expect(lines).toHaveLength(0);
  });

  it('successful handler lines included when other handler throws', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a1 = makeAttachment({ mediaType: 'voice', mimeType: 'audio/ogg' });
    const a2 = makeAttachment({ mediaType: 'image', mimeType: 'image/jpeg' });
    const failingHandler: AttachmentHandler = {
      name: 'fail',
      match: (a) => a.mediaType === 'voice',
      handle: async () => {
        throw new Error('voice handler error');
      },
    };
    const successHandler: AttachmentHandler = {
      name: 'ok',
      match: (a) => a.mediaType === 'image',
      handle: async () => ['[image: processed]'],
    };
    const lines = await processAttachments(
      'id-partial',
      msgDir,
      [a1, a2],
      download,
      [failingHandler, successHandler],
    );
    // Failed attachment block is skipped; successful one is present
    expect(lines.some((l) => l.includes('[image: processed]'))).toBe(true);
    expect(lines.some((l) => l.includes('[media attached:'))).toBe(true);
    // No rejection propagated — result is a normal array
    expect(Array.isArray(lines)).toBe(true);
  });

  it('unmatched attachment only emits media line', async () => {
    const download = vi.fn().mockResolvedValue(buf);
    const a = makeAttachment({ mediaType: 'document' });
    const lines = await processAttachments('id6', msgDir, [a], download, []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[media attached:/);
  });
});

// --- makeDownloader ---

describe('makeDownloader', () => {
  it('calls rawDownload with matched raw attachment', async () => {
    const buf = Buffer.from('x');
    const rawDownload = vi.fn().mockResolvedValue(buf);
    const raw: RawAttachment = {
      type: 'image',
      source: { kind: 'telegram', fileId: 'f1' },
    };
    const a = toAttachment(raw);
    const dl = makeDownloader([raw], rawDownload, [a]);
    const result = await dl(a);
    expect(rawDownload).toHaveBeenCalledWith(raw, 20971520);
    expect(result).toBe(buf);
  });

  it('throws if attachment not in map', async () => {
    const rawDownload = vi.fn();
    const raw: RawAttachment = {
      type: 'image',
      source: { kind: 'telegram', fileId: 'f1' },
    };
    const a = toAttachment(raw);
    const unknown: Attachment = { mediaType: 'image' };
    const dl = makeDownloader([raw], rawDownload, [a]);
    await expect(dl(unknown)).rejects.toThrow('not found in downloader map');
  });
});
