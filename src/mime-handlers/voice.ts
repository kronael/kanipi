import fs from 'fs';
import path from 'path';

import { VOICE_TRANSCRIPTION_ENABLED } from '../config.js';
import { AttachmentHandler } from '../mime.js';
import { logger } from '../logger.js';
import { whisperTranscribe } from './whisper.js';

function readLanguages(groupDir: string): string[] {
  const p = path.join(groupDir, '.whisper-language');
  try {
    return fs
      .readFileSync(p, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export const voiceHandler: AttachmentHandler = {
  name: 'whisper',

  match: (a) =>
    a.mediaType === 'voice' ||
    a.mediaType === 'audio' ||
    !!a.mimeType?.startsWith('audio/'),

  handle: async (a, localPath) => {
    if (!VOICE_TRANSCRIPTION_ENABLED) return [];

    const idx = localPath.indexOf(`${path.sep}media${path.sep}`);
    const groupDir = idx !== -1 ? localPath.slice(0, idx) : null;
    const languages = groupDir ? readLanguages(groupDir) : [];

    const passes: Array<string | undefined> = [undefined, ...languages];

    const results = await Promise.allSettled(
      passes.map((lang) => whisperTranscribe(localPath, lang)),
    );

    const lines: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        logger.warn({ err: r.reason, localPath }, 'voice: whisper pass failed');
        continue;
      }
      const { text, language: detected } = r.value;
      if (!text) continue;
      const forced = passes[i];
      const label = forced ? `voice/${forced}` : `voice/auto→${detected}`;
      lines.push(`[${label}: ${text}]`);
    }

    if (lines.length === 0) return [];
    const combined = lines.join('\n');
    fs.writeFileSync(localPath.replace(/\.\w+$/, '-whisper.txt'), combined);
    return [combined];
  },
};
