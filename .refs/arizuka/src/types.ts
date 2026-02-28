// --- NanoClaw types (preserved) ---

export interface AdditionalMount {
  hostPath: string;
  containerPath?: string;
  readonly?: boolean;
}

export interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
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

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
}

export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

// --- Per-agent configuration ---

export interface AgentConfig {
  /** CLAUDE.md content written to the agent's group folder */
  personality?: string;
  /** Container image override (default: global config) */
  image?: string;
  /** Extra host directories to mount into the container */
  mounts?: AdditionalMount[];
  /** Allow container network access (default: true — needed for Anthropic API) */
  network?: boolean;
  /** Per-agent timeout override in ms */
  timeout?: number;
  /** Per-agent concurrency limit */
  maxConcurrent?: number;
}

// --- Routing + middleware ---

export interface Binding {
  match: {
    channel: string;
    peer?: string;
    account?: string;
  };
  agent: string;
}

export interface RouteResult {
  agentId: string;
  channel: string;
  peerId: string;
  sessionKey: string;
  matchedBy: 'peer' | 'account' | 'channel' | 'default';
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface TapContext {
  agentId: string;
  channel: string;
  peerId: string;
  groupFolder: string;
}

export type Middleware = (call: ToolCall, ctx: TapContext) => ToolCall | null;

export interface Route {
  match: {
    tool: string;
    agent?: string;
  };
  middlewares: Middleware[];
}

export interface CredentialConfig {
  source: 'env';
  envVar: string;
}
