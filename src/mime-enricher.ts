import path from 'path';

import { GROUPS_DIR, MEDIA_ENABLED } from './config.js';
import { appendMessageContent } from './db.js';
import { logger } from './logger.js';
import {
  AttachmentDownloader,
  RawAttachment,
  makeDownloader,
  processAttachments,
  toAttachment,
} from './mime.js';
import { videoHandler } from './mime-handlers/video.js';
import { voiceHandler } from './mime-handlers/voice.js';

const pending = new Map<string, Promise<void>>();

export function enqueueEnrichment(
  msgId: string,
  groupFolder: string,
  attachments: RawAttachment[],
  download: AttachmentDownloader,
): void {
  if (!MEDIA_ENABLED) return;
  const bucket = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const msgDir = path.join(GROUPS_DIR, groupFolder, 'media', bucket, msgId);

  const promise = (async () => {
    try {
      const mapped = attachments.map(toAttachment);
      const dl = makeDownloader(attachments, download, mapped);
      const lines = await processAttachments(msgId, msgDir, mapped, dl, [
        voiceHandler,
        videoHandler,
      ]);
      logger.info({ msgId, lines }, 'mime: pipeline result');
      if (lines.length > 0) {
        appendMessageContent(msgId, '\n' + lines.join('\n'));
      }
    } catch (err) {
      logger.warn({ err, msgId }, 'mime enricher failed');
    } finally {
      pending.delete(msgId);
    }
  })();

  pending.set(msgId, promise);
}

export async function waitForEnrichments(msgIds: string[]): Promise<void> {
  const promises = msgIds.flatMap((id) => {
    const p = pending.get(id);
    return p ? [p] : [];
  });
  if (promises.length > 0) await Promise.all(promises);
}
