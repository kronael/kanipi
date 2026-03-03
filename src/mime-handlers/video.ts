import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { VIDEO_TRANSCRIPTION_ENABLED } from '../config.js';
import { AttachmentHandler } from '../mime.js';
import { logger } from '../logger.js';
import { whisperTranscribe } from './whisper.js';

function extractAudio(videoPath: string, audioPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'copy',
      '-y',
      audioPath,
    ]);
    let errOut = '';
    proc.stderr.on('data', (d) => {
      errOut += d.toString();
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('ffmpeg timeout after 60s'));
    }, 60_000);
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${errOut.slice(-200)}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export const videoHandler: AttachmentHandler = {
  name: 'video-whisper',

  match: (a) => a.mediaType === 'video' || !!a.mimeType?.startsWith('video/'),

  handle: async (a, localPath) => {
    if (!VIDEO_TRANSCRIPTION_ENABLED) return [];
    const audioPath = localPath.replace(/\.\w+$/, '-audio.aac');
    let text: string;
    try {
      await extractAudio(localPath, audioPath);
      text = await whisperTranscribe(audioPath);
    } catch (err) {
      logger.warn({ err, localPath }, 'video: transcription failed');
      return [];
    }
    fs.writeFileSync(localPath.replace(/\.\w+$/, '-whisper.txt'), text);
    return [`[video audio: ${text}]`];
  },
};
