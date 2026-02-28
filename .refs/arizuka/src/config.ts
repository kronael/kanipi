import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

import { logger } from './logger.js';
import { AgentConfig, Binding, CredentialConfig } from './types.js';

export interface ChannelConfig {
  enabled: boolean;
}

export interface WhatsAppConfig extends ChannelConfig {
  hasOwnNumber?: boolean;
}

export interface TelegramConfig extends ChannelConfig {
  token: string;
  pollingTimeout?: number;
}

export interface RawRoute {
  match: { tool: string; agent?: string };
  middleware: Array<{
    type: string;
    credential?: string;
    as?: string;
    envName?: string;
    header?: string;
    prefix?: string;
    reason?: string;
  }>;
}

export interface ArizukaConfig {
  assistant: {
    name: string;
    trigger: string;
    defaultAgent: string;
  };
  container: {
    image: string;
    timeout: number;
    maxConcurrent: number;
    idleTimeout: number;
  };
  channels: {
    whatsapp?: WhatsAppConfig;
    telegram?: TelegramConfig;
  };
  agents: Record<string, AgentConfig>;
  bindings: Binding[];
  routes: RawRoute[];
  credentials: Record<string, CredentialConfig>;
  /** Auto-register unknown Telegram chats with this agent (default: defaultAgent) */
  autoRegister?: boolean;
}

function interpolateEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, name) => {
    const val = process.env[name];
    if (val === undefined) {
      logger.warn({ var: name }, 'Config references unset env var');
      return '';
    }
    return val;
  });
}

function interpolateObject(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(interpolateObject);
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = interpolateObject(value);
    }
    return result;
  }
  return obj;
}

export function loadConfig(configPath?: string): ArizukaConfig {
  const file = configPath ?? path.join(process.cwd(), 'config.yaml');
  if (!fs.existsSync(file)) {
    throw new Error(`Config file not found: ${file}`);
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const parsed = YAML.parse(raw);
  const config = interpolateObject(parsed) as Record<string, unknown>;

  const assistant = (config.assistant ?? {}) as Record<string, unknown>;
  const container = (config.container ?? {}) as Record<string, unknown>;
  const channels = (config.channels ?? {}) as Record<string, unknown>;
  const rawAgents = (config.agents ?? {}) as Record<string, Record<string, unknown>>;

  const agents: Record<string, AgentConfig> = {};
  for (const [id, raw] of Object.entries(rawAgents)) {
    agents[id] = {
      personality: raw.personality != null ? String(raw.personality) : undefined,
      image: raw.image != null ? String(raw.image) : undefined,
      mounts: Array.isArray(raw.mounts) ? raw.mounts : undefined,
      network: raw.network != null ? Boolean(raw.network) : undefined,
      timeout: raw.timeout != null ? Number(raw.timeout) : undefined,
      maxConcurrent: raw.maxConcurrent != null ? Number(raw.maxConcurrent) : undefined,
    };
  }

  return {
    assistant: {
      name: String(assistant.name ?? 'Arizuka'),
      trigger: String(assistant.trigger ?? '@Arizuka'),
      defaultAgent: String(assistant.defaultAgent ?? 'main'),
    },
    container: {
      image: String(container.image ?? 'arizuka-agent:latest'),
      timeout: Number(container.timeout ?? 1800000),
      maxConcurrent: Number(container.maxConcurrent ?? 5),
      idleTimeout: Number(container.idleTimeout ?? 1800000),
    },
    channels: {
      whatsapp: channels.whatsapp
        ? (channels.whatsapp as WhatsAppConfig)
        : undefined,
      telegram: channels.telegram
        ? (channels.telegram as TelegramConfig)
        : undefined,
    },
    agents,
    bindings: Array.isArray(config.bindings)
      ? (config.bindings as Binding[])
      : [],
    routes: Array.isArray(config.routes) ? (config.routes as RawRoute[]) : [],
    credentials: (config.credentials as Record<string, CredentialConfig>) ?? {},
    autoRegister: config.autoRegister != null ? Boolean(config.autoRegister) : true,
  };
}

// --- Config singleton ---

let _config: ArizukaConfig | null = null;

export function getConfig(): ArizukaConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

export function initConfig(config: ArizukaConfig): void {
  _config = config;
  // Update mutable legacy exports
  ASSISTANT_NAME = config.assistant.name;
}

// --- Legacy-compatible exports (used by copied NanoClaw files) ---

const HOME_DIR = process.env.HOME || os.homedir();
const PROJECT_ROOT = process.cwd();

export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR, '.config', 'arizuka', 'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';
export const IPC_POLL_INTERVAL = 1000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// `let` export — ES module live binding means importers see the updated value
// after initConfig() is called.
export let ASSISTANT_NAME = 'Arizuka';

// Function-based accessors for new code
export function getAssistantName(): string {
  return _config?.assistant.name ?? ASSISTANT_NAME;
}
export function getContainerImage(): string {
  return _config?.container.image ?? 'arizuka-agent:latest';
}
export function getContainerTimeout(): number {
  return _config?.container.timeout ?? 1800000;
}
export function getMaxConcurrent(): number {
  return _config?.container.maxConcurrent ?? 5;
}
export function getIdleTimeout(): number {
  return _config?.container.idleTimeout ?? 1800000;
}
export function getAgentConfig(agentId: string): AgentConfig {
  return _config?.agents[agentId] ?? {};
}
export function getTriggerPattern(): RegExp {
  const name = getAssistantName();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^@${escaped}\\b`, 'i');
}
