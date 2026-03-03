/**
 * VoiceTranscriber enricher — downloads voice/audio attachments,
 * transcribes via local Whisper server, injects transcript annotation.
 */
import fs from 'fs';
import path from 'path';

import {
  MEDIA_MAX_FILE_BYTES,
  VOICE_TRANSCRIPTION_ENABLED,
  WHISPER_BASE_URL,
  WHISPER_MODEL,
} from '../config.js';
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

async function whisperTranscribe(
  filePath: string,
  model: string,
  baseUrl: string,
): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  const blob = new Blob([buf]);
  form.append('file', blob, path.basename(filePath));
  form.append('model', model);

  const res = await fetch(`${baseUrl}/inference`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text || '').trim();
}

export function buildVoiceEnricher(download: Downloader): MessageEnricher {
  return {
    name: 'voice-transcriber',

    matches(msg: InboundMessage): boolean {
      return (
        (msg.attachments || []).some(
          (a) =>
            a.type === 'voice' ||
            a.type === 'audio' ||
            a.mimeType?.startsWith('audio/'),
        ) && VOICE_TRANSCRIPTION_ENABLED
      );
    },

    async enrich(
      msg: EnrichedMessage,
      ctx: EnrichContext,
    ): Promise<EnrichedMessage> {
      const attachments = (msg.attachments || []).filter(
        (a) =>
          a.type === 'voice' ||
          a.type === 'audio' ||
          a.mimeType?.startsWith('audio/'),
      );

      const bucket = dateBucket();
      const bucketDir = path.join(ctx.mediaDir, bucket);
      fs.mkdirSync(bucketDir, { recursive: true });

      const enrichedAttachments: EnrichedAttachment[] = [];
      const annotations: ContextAnnotation[] = [];

      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        const ext = extFromAttachment(a);
        const base = `${msg.id}-${i}`;
        const filename = `${base}.${ext}`;
        const localPath = `media/${bucket}/${filename}`;
        const fullPath = path.join(bucketDir, filename);

        let buf: Buffer;
        try {
          buf = await download(a, MEDIA_MAX_FILE_BYTES);
        } catch (err) {
          logger.warn({ err, msgId: msg.id }, 'voice: download failed');
          continue;
        }

        fs.writeFileSync(fullPath, buf);
        logger.debug({ fullPath, bytes: buf.length }, 'voice: saved');

        let transcription: string | undefined;
        try {
          transcription = await whisperTranscribe(
            fullPath,
            WHISPER_MODEL,
            WHISPER_BASE_URL,
          );
          const sidecar = path.join(bucketDir, `${base}-whisper.txt`);
          fs.writeFileSync(sidecar, transcription);
          logger.debug({ sidecar }, 'voice: transcript saved');
        } catch (err) {
          logger.warn({ err, msgId: msg.id }, 'voice: whisper failed');
        }

        enrichedAttachments.push({
          type: a.type,
          localPath,
          filename,
          mimeType: a.mimeType,
          sizeBytes: buf.length,
          transcription,
        });

        if (transcription) {
          annotations.push({
            label: 'voice',
            content: transcription,
            order: 10,
          });
        }
      }

      if (!msg.enrichedAttachments) msg.enrichedAttachments = [];
      msg.enrichedAttachments.push(...enrichedAttachments);
      msg.contextAnnotations.push(...annotations);

      return msg;
    },
  };
}
