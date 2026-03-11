/**
 * MIME pipeline — save attachments, run handlers, produce annotation lines.
 */
import fs from 'fs';
import path from 'path';

import { fileTypeFromBuffer } from 'file-type';

import { MEDIA_MAX_FILE_BYTES } from './config.js';
import { logger } from './logger.js';

// --- Shared mime detection ---

export async function mimeFromFile(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const result = await fileTypeFromBuffer(buf);
  if (result) return result.mime;
  // fallback: text/plain for .txt/.csv, else octet-stream
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'txt' || ext === 'csv' || ext === 'md') return 'text/plain';
  return 'application/octet-stream';
}

// --- Channel-facing types (used by telegram.ts, whatsapp.ts, discord.ts) ---

export type AttachmentType =
  | 'image'
  | 'voice'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker';

export type TelegramSource = { kind: 'telegram'; fileId: string };
export type WhatsAppSource = {
  kind: 'whatsapp';
  message: Record<string, unknown>;
};
export type DiscordSource = { kind: 'discord'; url: string };

export interface RawAttachment {
  type: AttachmentType;
  mimeType?: string;
  filename?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  source: TelegramSource | WhatsAppSource | DiscordSource;
}

export type AttachmentDownloader = (
  a: RawAttachment,
  maxBytes: number,
) => Promise<Buffer>;

// --- Pipeline types ---

export interface Attachment {
  mediaType: string; // 'voice' | 'video' | 'image' | 'document' | ...
  mimeType?: string;
  filename?: string;
  sizeBytes?: number;
}

export type Downloader = (a: Attachment) => Promise<Buffer>;

export interface AttachmentHandler {
  name: string;
  match(a: Attachment): boolean;
  handle(a: Attachment, localPath: string): Promise<string[]>;
  // returns EXTRA lines — [media attached: ...] already appended by pipeline
}

// --- Helpers ---

export function extFromMime(
  mimeType: string | undefined,
  fallback: string,
): string {
  if (mimeType) {
    const sub = mimeType.split('/')[1];
    if (sub) return sub.split(';')[0].trim();
  }
  return fallback;
}

export function mediaLine(a: Attachment, localPath: string): string {
  // Extract container-relative path: ~/media/... instead of absolute path
  // e.g. /srv/app/home/groups/atlas/media/20260311/1004/0.png → ~/media/20260311/1004/0.png
  // Agent containers mount group folder as /home/node/, so ~ resolves correctly
  const mediaIndex = localPath.indexOf('/media/');
  const containerPath =
    mediaIndex >= 0 ? `~${localPath.slice(mediaIndex)}` : localPath;
  return `[media attached: ${containerPath}${a.mimeType ? ` (${a.mimeType})` : ''}]`;
}

function saveFile(
  buf: Buffer,
  msgDir: string,
  index: number,
  a: Attachment,
): string {
  const fallbacks: Record<string, string> = {
    voice: 'ogg',
    audio: 'mp3',
    video: 'mp4',
    image: 'jpg',
    document: 'bin',
    sticker: 'webp',
  };
  const ext = extFromMime(a.mimeType, fallbacks[a.mediaType] || 'bin');
  const filename = `${index}.${ext}`;
  const localPath = path.join(msgDir, filename);
  fs.writeFileSync(localPath, buf);
  return localPath;
}

// --- Pipeline ---

export async function processAttachments(
  msgId: string,
  msgDir: string,
  attachments: Attachment[],
  download: Downloader,
  handlers: AttachmentHandler[],
): Promise<string[]> {
  fs.mkdirSync(msgDir, { recursive: true });

  // Step 1: save all attachments in parallel
  const saved = await Promise.all(
    attachments.map(async (a, i) => {
      const buf = await download(a);
      const localPath = saveFile(buf, msgDir, i, a);
      logger.debug({ localPath, bytes: buf.length, msgId }, 'mime: saved');
      return { a, localPath };
    }),
  );

  // Step 2: run handlers per saved file, collect annotation lines
  const results = await Promise.allSettled(
    saved.map(async ({ a, localPath }) => {
      const handler = handlers.find((h) => h.match(a));
      const extra = handler ? await handler.handle(a, localPath) : [];
      return [...extra, mediaLine(a, localPath)];
    }),
  );

  // Flatten with blank line between blocks, skip failures
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (lines.length > 0) lines.push('');
      lines.push(...r.value);
    } else {
      logger.warn({ error: r.reason, msgId }, 'mime: handler failed');
    }
  }

  return lines;
}

// --- Adapter: convert channel types to pipeline types ---

export function toAttachment(raw: RawAttachment): Attachment {
  return {
    mediaType: raw.type,
    mimeType: raw.mimeType,
    filename: raw.filename,
    sizeBytes: raw.sizeBytes,
  };
}

/**
 * Wraps a channel downloader so it works with the Attachment pipeline.
 * Uses object identity to map each Attachment back to its RawAttachment.
 */
export function makeDownloader(
  rawAttachments: RawAttachment[],
  rawDownload: AttachmentDownloader,
  attachments: Attachment[],
): Downloader {
  const map = new Map<Attachment, RawAttachment>();
  for (let i = 0; i < attachments.length; i++) {
    map.set(attachments[i], rawAttachments[i]);
  }
  return async (a: Attachment) => {
    const raw = map.get(a);
    if (!raw) throw new Error('mime: attachment not found in downloader map');
    return rawDownload(raw, MEDIA_MAX_FILE_BYTES);
  };
}
