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

function readLanguage(groupDir: string): string | undefined {
  const p = path.join(groupDir, '.whisper-language');
  try {
    const lang = fs.readFileSync(p, 'utf-8').trim();
    return lang || undefined;
  } catch {
    return undefined;
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
    const language = groupDir ? readLanguage(groupDir) : undefined;
    let text: string;
    try {
      text = await whisperTranscribe(localPath, language);
    } catch (err) {
      logger.warn({ err, localPath, language }, 'voice: whisper failed');
      return [];
    }
    fs.writeFileSync(localPath.replace(/\.\w+$/, '-whisper.txt'), text);
    return [`[voice: ${text}]`];
  },
};
