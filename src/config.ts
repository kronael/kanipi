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
  'TWITTER_USERNAME',
  'TWITTER_PASSWORD',
  'TWITTER_EMAIL',
  'FACEBOOK_PAGE_ID',
  'FACEBOOK_PAGE_ACCESS_TOKEN',
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

// Channel configuration
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN || envConfig.DISCORD_BOT_TOKEN || '';

// Social channels — enabled by token/credential presence
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
export let SLINK_ANON_RPM = parseInt(process.env.SLINK_ANON_RPM || '10', 10);
export let SLINK_AUTH_RPM = parseInt(process.env.SLINK_AUTH_RPM || '60', 10);

// Public host for constructing slink URLs injected into agent containers
export const WEB_HOST = process.env.WEB_HOST || '';

// WEB_PUBLIC=1: no auth, no /pub/ redirect — serve everything from web root
export const WEB_PUBLIC = !!(process.env.WEB_PUBLIC || envConfig.WEB_PUBLIC);

// Auth — JWT signing secret for slink and future auth routes
export const AUTH_SECRET =
  process.env.AUTH_SECRET || envConfig.AUTH_SECRET || '';

// OAuth providers
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
export const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';

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

// Media / enricher pipeline config
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

// Snapshot of initial mutable config values for _resetConfig
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

// File transfer commands (/file put, /file get, /file list)
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
