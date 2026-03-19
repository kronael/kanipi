import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { readEnvFile } from './env.js';

const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'CONTAINER_IMAGE',
  'WEB_PORT',
  'VITE_PORT',
  'AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'ONBOARDING_ENABLED',
  'MEDIA_ENABLED',
  'MEDIA_MAX_FILE_BYTES',
  'VOICE_TRANSCRIPTION_ENABLED',
  'WHISPER_BASE_URL',
  'EMAIL_IMAP_HOST',
  'EMAIL_SMTP_HOST',
  'EMAIL_ACCOUNT',
  'EMAIL_PASSWORD',
  'WEB_PUBLIC',
  'MASTODON_INSTANCE_URL',
  'MASTODON_ACCESS_TOKEN',
  'BLUESKY_IDENTIFIER',
  'BLUESKY_PASSWORD',
  'BLUESKY_SERVICE_URL',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'REDDIT_USERNAME',
  'REDDIT_PASSWORD',
  'REDDIT_SUBREDDITS',
  'TWITTER_USERNAME',
  'TWITTER_PASSWORD',
  'TWITTER_EMAIL',
  'FACEBOOK_PAGE_ID',
  'FACEBOOK_PAGE_ACCESS_TOKEN',
  'WEBDAV_ENABLED',
  'WEBDAV_URL',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

const PROJECT_ROOT = process.env.DATA_DIR || process.cwd();
const HOST_PROJECT_ROOT = process.env.HOST_DATA_DIR || PROJECT_ROOT;
const HOME_DIR = process.env.HOME || os.homedir();
const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const HOST_GROUPS_DIR = path.resolve(HOST_PROJECT_ROOT, 'groups');
export const HOST_DATA_DIR = path.resolve(HOST_PROJECT_ROOT, 'data');
export const HOST_APP_DIR = process.env.HOST_APP_DIR || APP_DIR;
export function isRoot(folder: string): boolean {
  return folder === 'root';
}

export type PermissionTier = 0 | 1 | 2 | 3;

export function permissionTier(folder: string): PermissionTier {
  if (folder === 'root') return 0;
  return Math.min(folder.split('/').length, 3) as 1 | 2 | 3;
}

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE ||
  envConfig.CONTAINER_IMAGE ||
  'kanipi-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '3600000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
);
export const IPC_POLL_INTERVAL = 1000;
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default; falls back to UTC if invalid.
function resolveTimezone(): string {
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}
export const TIMEZONE = resolveTimezone();

export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN || envConfig.DISCORD_BOT_TOKEN || '';

export const MASTODON_INSTANCE_URL =
  process.env.MASTODON_INSTANCE_URL || envConfig.MASTODON_INSTANCE_URL || '';
export const MASTODON_ACCESS_TOKEN =
  process.env.MASTODON_ACCESS_TOKEN || envConfig.MASTODON_ACCESS_TOKEN || '';
export const BLUESKY_IDENTIFIER =
  process.env.BLUESKY_IDENTIFIER || envConfig.BLUESKY_IDENTIFIER || '';
export const BLUESKY_PASSWORD =
  process.env.BLUESKY_PASSWORD || envConfig.BLUESKY_PASSWORD || '';
export const BLUESKY_SERVICE_URL =
  process.env.BLUESKY_SERVICE_URL || envConfig.BLUESKY_SERVICE_URL || '';
export const REDDIT_CLIENT_ID =
  process.env.REDDIT_CLIENT_ID || envConfig.REDDIT_CLIENT_ID || '';
export const REDDIT_CLIENT_SECRET =
  process.env.REDDIT_CLIENT_SECRET || envConfig.REDDIT_CLIENT_SECRET || '';
export const REDDIT_USERNAME =
  process.env.REDDIT_USERNAME || envConfig.REDDIT_USERNAME || '';
export const REDDIT_PASSWORD =
  process.env.REDDIT_PASSWORD || envConfig.REDDIT_PASSWORD || '';
export const REDDIT_SUBREDDITS = (
  process.env.REDDIT_SUBREDDITS ||
  envConfig.REDDIT_SUBREDDITS ||
  ''
)
  .split(',')
  .filter(Boolean);
export const TWITTER_USERNAME =
  process.env.TWITTER_USERNAME || envConfig.TWITTER_USERNAME || '';
export const TWITTER_PASSWORD =
  process.env.TWITTER_PASSWORD || envConfig.TWITTER_PASSWORD || '';
export const TWITTER_EMAIL =
  process.env.TWITTER_EMAIL || envConfig.TWITTER_EMAIL || '';
export const FACEBOOK_PAGE_ID =
  process.env.FACEBOOK_PAGE_ID || envConfig.FACEBOOK_PAGE_ID || '';
export const FACEBOOK_PAGE_ACCESS_TOKEN =
  process.env.FACEBOOK_PAGE_ACCESS_TOKEN ||
  envConfig.FACEBOOK_PAGE_ACCESS_TOKEN ||
  '';

export const WEB_DIR = path.resolve(PROJECT_ROOT, 'web');
export const HOST_WEB_DIR = path.resolve(HOST_PROJECT_ROOT, 'web');

// Web proxy: WEB_PORT is the single external port (VITE_PORT also accepted).
// VITE_PORT_INTERNAL: actual internal Vite port; defaults to WEB_PORT+1.
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
export let SLINK_ANON_RPM = parseInt(process.env.SLINK_ANON_RPM || '10', 10);
export let SLINK_AUTH_RPM = parseInt(process.env.SLINK_AUTH_RPM || '60', 10);

export const WEB_HOST = process.env.WEB_HOST || '';

export const WEB_PUBLIC = !!(process.env.WEB_PUBLIC || envConfig.WEB_PUBLIC);

export const AUTH_SECRET =
  process.env.AUTH_SECRET || envConfig.AUTH_SECRET || '';

export const GITHUB_CLIENT_ID =
  process.env.GITHUB_CLIENT_ID || envConfig.GITHUB_CLIENT_ID || '';
export const GITHUB_CLIENT_SECRET =
  process.env.GITHUB_CLIENT_SECRET || envConfig.GITHUB_CLIENT_SECRET || '';
export const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || envConfig.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET || envConfig.GOOGLE_CLIENT_SECRET || '';
export const DISCORD_CLIENT_ID =
  process.env.DISCORD_CLIENT_ID || envConfig.DISCORD_CLIENT_ID || '';
export const DISCORD_CLIENT_SECRET =
  process.env.DISCORD_CLIENT_SECRET || envConfig.DISCORD_CLIENT_SECRET || '';

export function _overrideConfig(patch: {
  SLINK_ANON_RPM?: number;
  SLINK_AUTH_RPM?: number;
  WHISPER_BASE_URL?: string;
  VOICE_TRANSCRIPTION_ENABLED?: boolean;
  VIDEO_TRANSCRIPTION_ENABLED?: boolean;
  MEDIA_ENABLED?: boolean;
  MEDIA_MAX_FILE_BYTES?: number;
}): void {
  if (process.env.NODE_ENV !== 'test') return;
  if (patch.SLINK_ANON_RPM !== undefined) SLINK_ANON_RPM = patch.SLINK_ANON_RPM;
  if (patch.SLINK_AUTH_RPM !== undefined) SLINK_AUTH_RPM = patch.SLINK_AUTH_RPM;
  if (patch.WHISPER_BASE_URL !== undefined)
    WHISPER_BASE_URL = patch.WHISPER_BASE_URL;
  if (patch.VOICE_TRANSCRIPTION_ENABLED !== undefined)
    VOICE_TRANSCRIPTION_ENABLED = patch.VOICE_TRANSCRIPTION_ENABLED;
  if (patch.VIDEO_TRANSCRIPTION_ENABLED !== undefined)
    VIDEO_TRANSCRIPTION_ENABLED = patch.VIDEO_TRANSCRIPTION_ENABLED;
  if (patch.MEDIA_ENABLED !== undefined) MEDIA_ENABLED = patch.MEDIA_ENABLED;
  if (patch.MEDIA_MAX_FILE_BYTES !== undefined)
    MEDIA_MAX_FILE_BYTES = patch.MEDIA_MAX_FILE_BYTES;
}

export const WHATSAPP_AUTH_DIR = path.join(STORE_DIR, 'auth');
export function whatsappEnabled(): boolean {
  return fs.existsSync(path.join(WHATSAPP_AUTH_DIR, 'creds.json'));
}

export const ONBOARDING_ENABLED =
  (process.env.ONBOARDING_ENABLED || envConfig.ONBOARDING_ENABLED || '0') ===
  '1';
export let MEDIA_ENABLED =
  (process.env.MEDIA_ENABLED || envConfig.MEDIA_ENABLED || 'false') === 'true';
export let MEDIA_MAX_FILE_BYTES = parseInt(
  process.env.MEDIA_MAX_FILE_BYTES ||
    envConfig.MEDIA_MAX_FILE_BYTES ||
    '20971520',
  10,
);
export let VOICE_TRANSCRIPTION_ENABLED =
  (process.env.VOICE_TRANSCRIPTION_ENABLED ||
    envConfig.VOICE_TRANSCRIPTION_ENABLED ||
    'false') === 'true';
export let WHISPER_BASE_URL =
  process.env.WHISPER_BASE_URL ||
  envConfig.WHISPER_BASE_URL ||
  'http://localhost:8080';
export const WHISPER_MODEL = process.env.WHISPER_MODEL || 'turbo';
export let VIDEO_TRANSCRIPTION_ENABLED =
  (process.env.VIDEO_TRANSCRIPTION_ENABLED || 'false') === 'true';

const _configDefaults = {
  SLINK_ANON_RPM,
  SLINK_AUTH_RPM,
  MEDIA_ENABLED,
  MEDIA_MAX_FILE_BYTES,
  VOICE_TRANSCRIPTION_ENABLED,
  WHISPER_BASE_URL,
  VIDEO_TRANSCRIPTION_ENABLED,
};

export function _resetConfig(): void {
  if (process.env.NODE_ENV !== 'test') return;
  ({
    SLINK_ANON_RPM,
    SLINK_AUTH_RPM,
    MEDIA_ENABLED,
    MEDIA_MAX_FILE_BYTES,
    VOICE_TRANSCRIPTION_ENABLED,
    WHISPER_BASE_URL,
    VIDEO_TRANSCRIPTION_ENABLED,
  } = _configDefaults);
}

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

export const FILE_TRANSFER_ENABLED =
  (process.env.FILE_TRANSFER_ENABLED || 'false') === 'true';
export const FILE_DENY_GLOBS = (
  process.env.FILE_DENY_GLOBS || '.git/**,.env,.envrc,**/*.pem'
).split(',');
export const FILE_MAX_UPLOAD_BYTES = parseInt(
  process.env.FILE_MAX_UPLOAD_BYTES || '20971520',
  10,
);
export const FILE_MAX_DOWNLOAD_BYTES = parseInt(
  process.env.FILE_MAX_DOWNLOAD_BYTES || '52428800',
  10,
);

export const WEBDAV_ENABLED =
  (process.env.WEBDAV_ENABLED || envConfig.WEBDAV_ENABLED || 'false') ===
  'true';
export const WEBDAV_URL =
  process.env.WEBDAV_URL || envConfig.WEBDAV_URL || 'http://localhost:8179';
