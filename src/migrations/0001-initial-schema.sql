-- Initial schema: all core tables at baseline state
-- This represents the schema after all inline migrations have been applied

CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  last_message_time TEXT,
  channel TEXT,
  is_group INTEGER DEFAULT 0,
  errored INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT,
  chat_jid TEXT,
  sender TEXT,
  sender_name TEXT,
  content TEXT,
  timestamp TEXT,
  is_from_me INTEGER,
  is_bot_message INTEGER DEFAULT 0,
  forwarded_from TEXT,
  reply_to_text TEXT,
  reply_to_sender TEXT,
  PRIMARY KEY (id, chat_jid),
  FOREIGN KEY (chat_jid) REFERENCES chats(jid)
);
CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  group_folder TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_value TEXT NOT NULL,
  context_mode TEXT DEFAULT 'isolated',
  next_run TEXT,
  last_run TEXT,
  last_result TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

CREATE TABLE IF NOT EXISTS task_run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

CREATE TABLE IF NOT EXISTS router_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  event TEXT,
  attrs TEXT,
  body TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_history (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  session_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  message_count INTEGER,
  result TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_history ON session_history(group_id, started_at);

CREATE TABLE IF NOT EXISTS registered_groups (
  jid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder TEXT NOT NULL UNIQUE,
  trigger_pattern TEXT NOT NULL,
  added_at TEXT NOT NULL,
  container_config TEXT,
  requires_trigger INTEGER DEFAULT 1,
  slink_token TEXT,
  parent TEXT,
  routing_rules TEXT
);

CREATE TABLE IF NOT EXISTS email_threads (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  from_address TEXT NOT NULL,
  root_msg_id TEXT NOT NULL,
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_thread ON email_threads(thread_id);

CREATE TABLE IF NOT EXISTS auth_users (
  id INTEGER PRIMARY KEY,
  sub TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
