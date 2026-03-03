/**
 * Enricher pipeline — runs before container dispatch.
 * All matching enrichers run in parallel; failures are logged and skipped.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import { logger } from './logger.js';

export type AttachmentDownloader = (
  a: RawAttachment,
  maxBytes: number,
) => Promise<Buffer>;

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

export interface EnrichedAttachment {
  type: AttachmentType;
  localPath: string; // relative to groupDir (mounted at /workspace/media/)
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  transcription?: string;
  annotation?: string;
}

export interface ContextAnnotation {
  label: string;
  content: string;
  order: number;
}

export interface InboundMessage {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  text: string;
  timestamp: string;
  channel: 'telegram' | 'whatsapp' | 'discord';
  groupFolder: string;
  isMain: boolean;
  attachments?: RawAttachment[];
  replyToText?: string;
  replyToSender?: string;
  threadId?: string;
  mediaGroupId?: string;
}

export interface EnrichedMessage extends InboundMessage {
  enrichedAttachments?: EnrichedAttachment[];
  contextAnnotations: ContextAnnotation[];
}

export interface EnrichContext {
  groupDir: string;
  mediaDir: string;
}

export interface MessageEnricher {
  name: string;
  matches(msg: InboundMessage): boolean;
  enrich(msg: EnrichedMessage, ctx: EnrichContext): Promise<EnrichedMessage>;
}

function merge(base: EnrichedMessage, update: EnrichedMessage): void {
  if (update.enrichedAttachments) {
    if (!base.enrichedAttachments) base.enrichedAttachments = [];
    for (const a of update.enrichedAttachments) {
      const exists = base.enrichedAttachments.find(
        (e) => e.localPath === a.localPath,
      );
      if (!exists) base.enrichedAttachments.push(a);
      else Object.assign(exists, a);
    }
  }
  for (const ann of update.contextAnnotations) {
    const dup = base.contextAnnotations.find(
      (a) => a.label === ann.label && a.content === ann.content,
    );
    if (!dup) base.contextAnnotations.push(ann);
  }
}

export async function runEnrichers(
  msg: InboundMessage,
  enrichers: MessageEnricher[],
  ctx: EnrichContext,
): Promise<EnrichedMessage> {
  const enriched: EnrichedMessage = { ...msg, contextAnnotations: [] };

  const matching = enrichers.filter((e) => e.matches(msg));
  if (matching.length === 0) return enriched;

  const results = await Promise.allSettled(
    matching.map((e) => e.enrich({ ...enriched }, ctx)),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') merge(enriched, r.value);
    else logger.warn({ error: r.reason }, 'enricher failed');
  }

  enriched.contextAnnotations.sort((a, b) => a.order - b.order);
  return enriched;
}

/**
 * Build prompt string from enriched message.
 * Injects <attachment> blocks before the user's text.
 */
export function buildPrompt(msg: EnrichedMessage): string {
  const parts: string[] = [];

  if (msg.enrichedAttachments && msg.enrichedAttachments.length > 0) {
    msg.enrichedAttachments.forEach((a, i) => {
      const agentPath = `/workspace/media/${a.localPath.replace(/^media\//, '')}`;
      const lines = [
        `<attachment index="${i}" type="${a.type}" path="${agentPath}">`,
      ];
      if (a.transcription) {
        lines.push(`  <transcript>${a.transcription}</transcript>`);
      } else {
        lines.push(
          `  <description>file saved, no further enrichment</description>`,
        );
      }
      lines.push('</attachment>');
      parts.push(lines.join('\n'));
    });
    parts.push('');
  }

  parts.push(msg.text);
  return parts.join('\n');
}

/**
 * Resolve the media dir for a group folder, creating it if needed.
 * Returns { groupDir, mediaDir }.
 */
export function resolveMediaDirs(groupFolder: string): {
  groupDir: string;
  mediaDir: string;
} {
  const groupDir = path.join(GROUPS_DIR, groupFolder);
  const mediaDir = path.join(groupDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  return { groupDir, mediaDir };
}

/**
 * Date string YYYYMMDD for bucketing media files.
 */
export function dateBucket(d = new Date()): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Derive file extension from mimeType or attachment type.
 */
export function extFromAttachment(a: RawAttachment): string {
  if (a.mimeType) {
    const sub = a.mimeType.split('/')[1];
    if (sub) return sub.split(';')[0].trim();
  }
  const fallbacks: Record<AttachmentType, string> = {
    voice: 'ogg',
    audio: 'mp3',
    video: 'mp4',
    image: 'jpg',
    document: 'bin',
    sticker: 'webp',
  };
  return fallbacks[a.type] || 'bin';
}
