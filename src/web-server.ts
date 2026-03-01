import fs from 'fs';

import { logger } from './logger.js';

const VITE_PID_FILE = '/srv/app/tmp/vite.pid';

export function restartVite(): void {
  let pid: number;
  try {
    pid = parseInt(fs.readFileSync(VITE_PID_FILE, 'utf-8').trim(), 10);
  } catch {
    logger.warn('Vite PID file not found, cannot restart');
    return;
  }
  if (isNaN(pid)) {
    logger.warn('Invalid vite PID');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
    logger.info({ pid }, 'Vite process killed for restart');
  } catch (err) {
    logger.warn({ pid, err }, 'Failed to kill vite process');
  }
}
