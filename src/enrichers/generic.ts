/**
 * GenericFileSaver enricher — saves images, stickers, documents,
 * and any attachment not handled by a more specific enricher.
 */
import fs from 'fs';
import path from 'path';

import { MEDIA_ENABLED, MEDIA_MAX_FILE_BYTES } from '../config.js';
import {
  ContextAnnotation,
  EnrichedAttachment,
  EnrichedMessage,
  EnrichContext,
  InboundMessage,
  MessageEnricher,
  RawAttachment,
  dateBucket,
  extFromAttachment,
} from '../enricher-pipeline.js';
import { logger } from '../logger.js';

type Downloader = (a: RawAttachment, maxBytes: number) => Promise<Buffer>;

// Types handled by more specific enrichers — skip them here.
const SPECIFIC_TYPES = new Set(['voice', 'audio', 'video']);

export function buildGenericEnricher(download: Downloader): MessageEnricher {
  return {
    name: 'generic-saver',

    matches(msg: InboundMessage): boolean {
      return (
        MEDIA_ENABLED &&
        (msg.attachments || []).some(
          (a) =>
            !SPECIFIC_TYPES.has(a.type) &&
            !a.mimeType?.startsWith('audio/') &&
            !a.mimeType?.startsWith('video/'),
        )
      );
    },

    async enrich(
      msg: EnrichedMessage,
      ctx: EnrichContext,
    ): Promise<EnrichedMessage> {
      const attachments = (msg.attachments || []).filter(
        (a) =>
          !SPECIFIC_TYPES.has(a.type) &&
          !a.mimeType?.startsWith('audio/') &&
          !a.mimeType?.startsWith('video/'),
      );

      const bucket = dateBucket();
      const bucketDir = path.join(ctx.mediaDir, bucket);
      fs.mkdirSync(bucketDir, { recursive: true });

      const enrichedAttachments: EnrichedAttachment[] = [];
      const annotations: ContextAnnotation[] = [];

      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        const ext = extFromAttachment(a);
        const base = a.filename
          ? `${msg.id}-${i}-${path.parse(a.filename).name}`
          : `${msg.id}-${i}`;
        const filename = `${base}.${ext}`;
        const localPath = `media/${bucket}/${filename}`;
        const fullPath = path.join(bucketDir, filename);

        let buf: Buffer;
        try {
          buf = await download(a, MEDIA_MAX_FILE_BYTES);
        } catch (err) {
          logger.warn({ err, msgId: msg.id }, 'generic: download failed');
          continue;
        }

        fs.writeFileSync(fullPath, buf);
        logger.debug({ fullPath, bytes: buf.length }, 'generic: saved');

        enrichedAttachments.push({
          type: a.type,
          localPath,
          filename,
          mimeType: a.mimeType,
          sizeBytes: buf.length,
        });

        annotations.push({
          label: 'file',
          content: filename,
          order: 30,
        });
      }

      if (!msg.enrichedAttachments) msg.enrichedAttachments = [];
      msg.enrichedAttachments.push(...enrichedAttachments);
      msg.contextAnnotations.push(...annotations);

      return msg;
    },
  };
}
