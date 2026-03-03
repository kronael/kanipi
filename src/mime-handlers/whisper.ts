import fs from 'fs';
import path from 'path';

import { WHISPER_BASE_URL, WHISPER_MODEL } from '../config.js';

export async function whisperTranscribe(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  const blob = new Blob([buf]);
  form.append('file', blob, path.basename(filePath));
  form.append('model', WHISPER_MODEL);

  const res = await fetch(`${WHISPER_BASE_URL}/inference`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`whisper HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { text?: string };
  return (json.text || '').trim();
}
