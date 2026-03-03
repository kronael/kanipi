import fs from 'fs';

import { VOICE_TRANSCRIPTION_ENABLED } from '../config.js';
import { AttachmentHandler } from '../mime.js';
import { logger } from '../logger.js';
import { whisperTranscribe } from './whisper.js';

export const voiceHandler: AttachmentHandler = {
  name: 'whisper',

  match: (a) =>
    a.mediaType === 'voice' ||
    a.mediaType === 'audio' ||
    !!a.mimeType?.startsWith('audio/'),

  handle: async (a, localPath) => {
    if (!VOICE_TRANSCRIPTION_ENABLED) return [];
    let text: string;
    try {
      text = await whisperTranscribe(localPath);
    } catch (err) {
      logger.warn({ err, localPath }, 'voice: whisper failed');
      return [];
    }
    fs.writeFileSync(localPath.replace(/\.\w+$/, '-whisper.txt'), text);
    return [`[voice: ${text}]`];
  },
};
