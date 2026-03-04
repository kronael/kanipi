import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'CONTAINER_IMAGE',
  'WEB_PORT',
  'VITE_PORT',
  'SLOTH_USERS',
  'AUTH_SECRET',
  'AUTH_PASSWORD',
  'MEDIA_ENABLED',
  'MEDIA_MAX_FILE_BYTES',
  'VOICE_TRANSCRIPTION_ENABLED',
  'WHISPER_BASE_URL',
  'EMAIL_IMAP_HOST',
  'EMAIL_SMTP_HOST',
  'EMAIL_ACCOUNT',
  'EMAIL_PASSWORD',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.env.DATA_DIR || process.cwd();
const HOST_PROJECT_ROOT = process.env.HOST_DATA_DIR || PROJECT_ROOT;
const HOME_DIR = process.env.HOME || os.homedir();
const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const HOST_PROJECT_ROOT_PATH = HOST_PROJECT_ROOT;
export const HOST_APP_DIR = process.env.HOST_APP_DIR || APP_DIR;
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE ||
  envConfig.CONTAINER_IMAGE ||
  'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Channel configuration
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN || envConfig.DISCORD_BOT_TOKEN || '';

export const WEB_DIR = path.resolve(PROJECT_ROOT, 'web');

// Web proxy (sloth): WEB_PORT is the single external port.
// Falls back to VITE_PORT for backward compat with existing instances.
// VITE_PORT_INTERNAL: bash entrypoint exports the actual internal Vite port;
// falls back to WEB_PORT+1 if not set.
const _webPort =
  process.env.WEB_PORT ||
  envConfig.WEB_PORT ||
  process.env.VITE_PORT ||
  envConfig.VITE_PORT ||
  '';
export const WEB_PORT = _webPort ? parseInt(_webPort, 10) : 0;
const _viteInternal = process.env.VITE_PORT_INTERNAL || '';
export const VITE_PORT_INTERNAL = _viteInternal
  ? parseInt(_viteInternal, 10)
  : WEB_PORT
    ? WEB_PORT + 1
    : 5174;
// SLOTH_USERS format: "alice:pass,bob:pass2"
export const SLOTH_USERS =
  process.env.SLOTH_USERS || envConfig.SLOTH_USERS || '';

// Slink rate limits (requests per minute)
export const SLINK_ANON_RPM = parseInt(process.env.SLINK_ANON_RPM || '10', 10);
export const SLINK_AUTH_RPM = parseInt(process.env.SLINK_AUTH_RPM || '60', 10);

// Public host for constructing slink URLs injected into agent containers
export const WEB_HOST = process.env.WEB_HOST || '';

// Auth
export const AUTH_SECRET =
  process.env.AUTH_SECRET || envConfig.AUTH_SECRET || '';
export const AUTH_PASSWORD =
  process.env.AUTH_PASSWORD || envConfig.AUTH_PASSWORD || 'password';

export function _overrideConfig(patch: Partial<Record<string, unknown>>): void {
  if (process.env.NODE_ENV !== 'test') return;
  Object.assign(
    process.env,
    Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])),
  );
}

export const WHATSAPP_AUTH_DIR = path.join(STORE_DIR, 'auth');
export function whatsappEnabled(): boolean {
  return fs.existsSync(path.join(WHATSAPP_AUTH_DIR, 'creds.json'));
}

// Media / enricher pipeline config
export const MEDIA_ENABLED =
  (process.env.MEDIA_ENABLED || envConfig.MEDIA_ENABLED || 'false') === 'true';
export const MEDIA_MAX_FILE_BYTES = parseInt(
  process.env.MEDIA_MAX_FILE_BYTES ||
    envConfig.MEDIA_MAX_FILE_BYTES ||
    '20971520',
  10,
);
export const VOICE_TRANSCRIPTION_ENABLED =
  (process.env.VOICE_TRANSCRIPTION_ENABLED ||
    envConfig.VOICE_TRANSCRIPTION_ENABLED ||
    'false') === 'true';
export const WHISPER_BASE_URL =
  process.env.WHISPER_BASE_URL ||
  envConfig.WHISPER_BASE_URL ||
  'http://localhost:8080';
export const WHISPER_MODEL = process.env.WHISPER_MODEL || 'turbo';
export const VIDEO_TRANSCRIPTION_ENABLED =
  (process.env.VIDEO_TRANSCRIPTION_ENABLED || 'false') === 'true';

export const EMAIL_IMAP_HOST =
  process.env.EMAIL_IMAP_HOST || envConfig.EMAIL_IMAP_HOST || '';
export const EMAIL_SMTP_HOST =
  process.env.EMAIL_SMTP_HOST ||
  envConfig.EMAIL_SMTP_HOST ||
  EMAIL_IMAP_HOST.replace('imap.', 'smtp.');
export const EMAIL_ACCOUNT =
  process.env.EMAIL_ACCOUNT || envConfig.EMAIL_ACCOUNT || '';
export const EMAIL_PASSWORD =
  process.env.EMAIL_PASSWORD || envConfig.EMAIL_PASSWORD || '';
