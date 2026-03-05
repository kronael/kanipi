import fs from 'fs';
import path from 'path';

import { VOICE_TRANSCRIPTION_ENABLED } from '../config.js';
import { AttachmentHandler } from '../mime.js';
import { logger } from '../logger.js';
import { whisperTranscribe } from './whisper.js';

// localPath is GROUPS_DIR/<folder>/media/<date>/<msgId>/<file>
// group dir is the part before /media/
function groupDirFromLocalPath(localPath: string): string | null {
  const idx = localPath.indexOf(`${path.sep}media${path.sep}`);
  return idx !== -1 ? localPath.slice(0, idx) : null;
}

// Returns language codes from .whisper-language (one per line, empty = auto only).
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

    const groupDir = groupDirFromLocalPath(localPath);
    const languages = groupDir ? readLanguages(groupDir) : [];

    // Always include auto-detect; add one forced pass per configured language.
    const passes: Array<string | undefined> = [undefined, ...languages];

    const results = await Promise.allSettled(
      passes.map((lang) => whisperTranscribe(localPath, lang)),
    );

    const lines: string[] = [];
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn({ err: r.reason, localPath }, 'voice: whisper pass failed');
        continue;
      }
      const { text, language: detected } = r.value;
      if (!text) continue;
      // forced pass label: "voice/cs"; auto pass label: "voice/auto→cs"
      const forced = passes[results.indexOf(r)];
      const label = forced ? `voice/${forced}` : `voice/auto→${detected}`;
      lines.push(`[${label}: ${text}]`);
    }

    if (lines.length === 0) return [];
    const combined = lines.join('\n');
    fs.writeFileSync(localPath.replace(/\.\w+$/, '-whisper.txt'), combined);
    return [combined];
  },
};
