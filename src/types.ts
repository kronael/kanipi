import { z } from 'zod';

export const Verb = {
  Message: 'message',
  Reply: 'reply',
  Post: 'post',
  React: 'react',
  Repost: 'repost',
  Follow: 'follow',
  Join: 'join',
  Edit: 'edit',
  Delete: 'delete',
  Close: 'close',
} as const;
export type Verb = (typeof Verb)[keyof typeof Verb];

export const Platform = {
  Telegram: 'telegram',
  WhatsApp: 'whatsapp',
  Discord: 'discord',
  Email: 'email',
  Web: 'web',
  Reddit: 'reddit',
  Twitter: 'twitter',
  Mastodon: 'mastodon',
  Bluesky: 'bluesky',
  Twitch: 'twitch',
  YouTube: 'youtube',
  Facebook: 'facebook',
  Instagram: 'instagram',
  Threads: 'threads',
  LinkedIn: 'linkedin',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface SidecarSpec {
  image: string;
  env?: Record<string, string>;
  memoryMb?: number; // --memory (default: 256)
  cpus?: number; // --cpus (default: 0.5)
  network?: 'bridge' | 'none'; // default: none
  allowedTools?: string[]; // ["search", "fetch"] or ["*"]
}

export interface SidecarHandle {
  containerName: string;
  specName: string;
  sockPath: string;
  allowedTools?: string[];
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
  sidecars?: Record<string, SidecarSpec>;
}

// Flat routing table row
export interface Route {
  id: number;
  jid: string;
  seq: number;
  type:
    | 'command'
    | 'verb'
    | 'pattern'
    | 'keyword'
    | 'sender'
    | 'default'
    | 'trigger';
  match: string | null;
  target: string;
}

// Zod schemas for DB JSON field validation

export const AdditionalMountSchema = z.object({
  hostPath: z.string(),
  containerPath: z.string().optional(),
  readonly: z.boolean().optional(),
});

export const SidecarSpecSchema = z.object({
  image: z.string(),
  env: z.record(z.string(), z.string()).optional(),
  memoryMb: z.number().optional(),
  cpus: z.number().optional(),
  network: z.enum(['bridge', 'none']).optional(),
  allowedTools: z.array(z.string()).optional(),
});

export const ContainerConfigSchema = z.object({
  additionalMounts: z.array(AdditionalMountSchema).optional(),
  timeout: z.number().optional(),
  sidecars: z.record(z.string(), SidecarSpecSchema).optional(),
});

export interface SendOpts {
  replyTo?: string;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name?: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  replyTo?: string;
  forwarded_from?: string;
  reply_to_text?: string;
  reply_to_sender?: string;
  verb?: Verb;
  platform?: Platform;
  mentions?: string[];
  mentions_me?: boolean;
  thread?: string;
  parent?: string;
  root?: string;
  target?: string;
  target_author?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string, opts?: SendOpts): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  sendDocument?(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void>;
}

// Callback type that channels use to deliver inbound messages.
// attachments is optional raw attachment list for the enricher pipeline.
export type OnInboundMessage = (
  chatJid: string,
  message: NewMessage,
  attachments?: import('./mime.js').RawAttachment[],
  download?: import('./mime.js').AttachmentDownloader,
) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (WhatsApp syncGroupMetadata) omit it.
export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

export interface ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  isRoutedJid: (jid: string) => boolean;
  hasAlwaysOnGroup: () => boolean;
}

export type InboundEvent = NewMessage;
