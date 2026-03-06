import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  ContainerConfigSchema,
  NewMessage,
  RegisteredGroup,
  RoutingRuleSchema,
  ScheduledTask,
  TaskRunLog,
} from './types.js';

let db: Database.Database;
export function setDatabase(d: Database.Database): void {
  db = d;
}

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
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
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      origin   TEXT NOT NULL,
      event    TEXT,
      attrs    TEXT,
      body     TEXT NOT NULL,
      ts       TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_history (
      id            TEXT PRIMARY KEY,
      group_id      TEXT NOT NULL,
      session_id    TEXT,
      started_at    TEXT NOT NULL,
      ended_at      TEXT,
      message_count INTEGER,
      result        TEXT,
      error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_history
      ON session_history(group_id, started_at);
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS email_threads (
      message_id   TEXT PRIMARY KEY,
      thread_id    TEXT NOT NULL,
      from_address TEXT NOT NULL,
      root_msg_id  TEXT NOT NULL,
      seen_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_thread ON email_threads(thread_id);
  `);

  // Auth tables (added later — safe to CREATE IF NOT EXISTS)
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id         INTEGER PRIMARY KEY,
      sub        TEXT UNIQUE NOT NULL,
      username   TEXT UNIQUE NOT NULL,
      hash       TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_sub   TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Add slink_token column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE registered_groups ADD COLUMN slink_token TEXT`);
  } catch {
    /* column already exists */
  }

  // Add parent and routing_rules columns (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE registered_groups ADD COLUMN parent TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(
      `ALTER TABLE registered_groups ADD COLUMN routing_rules TEXT`,
    );
  } catch {
    /* column already exists */
  }

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add forward/reply metadata columns (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE messages ADD COLUMN forwarded_from TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE messages ADD COLUMN reply_to_text TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    database.exec(`ALTER TABLE messages ADD COLUMN reply_to_sender TEXT`);
  } catch {
    /* column already exists */
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add channel and is_group columns if they don't exist (migration for existing DBs)
  try {
    database.exec(`ALTER TABLE chats ADD COLUMN channel TEXT`);
    database.exec(`ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`);
    // Backfill from JID patterns
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`,
    );
    database.exec(
      `UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'telegram:%'`,
    );
  } catch {
    /* columns already exist */
  }

  // Migrate JID prefixes: tg: → telegram:, bare whatsapp → whatsapp:
  const { user_version: ver } = database
    .prepare('PRAGMA user_version')
    .get() as { user_version: number };
  if (ver < 1) {
    database.exec(`
      UPDATE messages SET chat_jid = 'telegram:' || SUBSTR(chat_jid, 4) WHERE chat_jid LIKE 'tg:%';
      UPDATE registered_groups SET jid = 'telegram:' || SUBSTR(jid, 4) WHERE jid LIKE 'tg:%';
      UPDATE chats SET jid = 'telegram:' || SUBSTR(jid, 4) WHERE jid LIKE 'tg:%';
      UPDATE scheduled_tasks SET chat_jid = 'telegram:' || SUBSTR(chat_jid, 4) WHERE chat_jid LIKE 'tg:%';

      UPDATE messages SET chat_jid = 'whatsapp:' || chat_jid WHERE chat_jid LIKE '%@g.us' OR chat_jid LIKE '%@s.whatsapp.net';
      UPDATE registered_groups SET jid = 'whatsapp:' || jid WHERE jid LIKE '%@g.us' OR jid LIKE '%@s.whatsapp.net';
      UPDATE chats SET jid = 'whatsapp:' || jid WHERE jid LIKE '%@g.us' OR jid LIKE '%@s.whatsapp.net';
      UPDATE scheduled_tasks SET chat_jid = 'whatsapp:' || chat_jid WHERE (chat_jid LIKE '%@g.us' OR chat_jid LIKE '%@s.whatsapp.net') AND chat_jid NOT LIKE 'whatsapp:%';

      PRAGMA user_version = 1;
    `);
    logger.info('Migrated JID prefixes (tg: → telegram:, bare → whatsapp:)');
  }
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

export function _setRawGroupColumns(
  jid: string,
  cols: { container_config?: string; routing_rules?: string },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups
       (jid, name, folder, trigger_pattern, added_at, container_config,
        requires_trigger, slink_token, parent, routing_rules)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL, ?)`,
  ).run(
    jid,
    'test',
    'test',
    '',
    '2024-01-01T00:00:00.000Z',
    cols.container_config ?? null,
    cols.routing_rules ?? null,
  );
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;
  const n = name || chatJid;

  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      name = CASE WHEN ? THEN excluded.name ELSE name END,
      last_message_time = MAX(last_message_time, excluded.last_message_time),
      channel = COALESCE(excluded.channel, channel),
      is_group = COALESCE(excluded.is_group, is_group)
  `,
  ).run(chatJid, n, timestamp, ch, group, name ? 1 : 0);
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function appendMessageContent(id: string, suffix: string): void {
  db.prepare(`UPDATE messages SET content = content || ? WHERE id = ?`).run(
    suffix,
    id,
  );
}

export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, forwarded_from, reply_to_text, reply_to_sender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    msg.forwarded_from ?? null,
    msg.reply_to_text ?? null,
    msg.reply_to_sender ?? null,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, forwarded_from, reply_to_text, reply_to_sender
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders})
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

const MSG_LIMIT = 100;

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  const since = sinceTimestamp || '';
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp, forwarded_from, reply_to_text, reply_to_sender
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT ?
  `;
  const rows = db
    .prepare(sql)
    .all(chatJid, since, `${botPrefix}:%`, MSG_LIMIT) as NewMessage[];
  return rows.reverse();
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function deleteSession(groupFolder: string): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(groupFolder);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- System message accessors ---

export interface SystemMessage {
  origin: string;
  event?: string;
  attrs?: Record<string, string>;
  body: string;
}

export function enqueueSystemMessage(
  groupId: string,
  msg: SystemMessage,
): void {
  db.prepare(
    `INSERT INTO system_messages (group_id, origin, event, attrs, body, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    groupId,
    msg.origin,
    msg.event ?? null,
    msg.attrs ? JSON.stringify(msg.attrs) : null,
    msg.body,
    new Date().toISOString(),
  );
}

export function flushSystemMessages(groupId: string): string {
  let xml = '';
  db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT origin, event, attrs, body FROM system_messages
         WHERE group_id = ? ORDER BY id`,
      )
      .all(groupId) as Array<{
      origin: string;
      event: string | null;
      attrs: string | null;
      body: string;
    }>;
    if (rows.length === 0) return;
    xml = rows
      .map((r) => {
        let tag = `<system origin="${r.origin}"`;
        if (r.event) tag += ` event="${r.event}"`;
        if (r.attrs) {
          for (const [k, v] of Object.entries(
            JSON.parse(r.attrs) as Record<string, string>,
          )) {
            tag += ` ${k}="${v}"`;
          }
        }
        tag += `>${r.body}</system>`;
        return tag;
      })
      .join('\n');
    db.prepare('DELETE FROM system_messages WHERE group_id = ?').run(groupId);
  })();
  return xml;
}

// --- Session history accessors ---

export interface SessionRecord {
  id: string;
  group_id: string;
  session_id: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number | null;
  result: string | null;
  error: string | null;
}

export function recordSessionStart(
  rowId: string,
  groupId: string,
  startedAt: string,
): void {
  db.prepare(
    `INSERT INTO session_history (id, group_id, started_at)
     VALUES (?, ?, ?)`,
  ).run(rowId, groupId, startedAt);
}

export function updateSessionEnd(
  rowId: string,
  sessionId: string | undefined,
  endedAt: string,
  result: 'ok' | 'error' | 'unknown',
  error: string | undefined,
  messageCount: number,
): void {
  db.prepare(
    `UPDATE session_history
     SET session_id = ?, ended_at = ?, result = ?, error = ?,
         message_count = ?
     WHERE id = ?`,
  ).run(sessionId ?? null, endedAt, result, error ?? null, messageCount, rowId);
}

export function getRecentSessions(
  groupId: string,
  limit: number,
): SessionRecord[] {
  return db
    .prepare(
      `SELECT * FROM session_history
       WHERE group_id = ? AND session_id IS NOT NULL
       ORDER BY started_at DESC LIMIT ?`,
    )
    .all(groupId, limit) as SessionRecord[];
}

// --- Registered group accessors ---

type GroupRow = {
  jid: string;
  name: string;
  folder: string;
  trigger_pattern: string;
  added_at: string;
  container_config: string | null;
  requires_trigger: number | null;
  slink_token: string | null;
  parent: string | null;
  routing_rules: string | null;
};

function parseContainerConfig(raw: string, jid: string) {
  try {
    const r = ContainerConfigSchema.safeParse(JSON.parse(raw));
    if (!r.success) {
      logger.warn(
        { jid, errors: r.error.issues },
        'container_config schema invalid, ignoring',
      );
      return undefined;
    }
    return r.data;
  } catch {
    logger.warn({ jid }, 'container_config is not valid JSON, ignoring');
    return undefined;
  }
}

function parseRoutingRules(raw: string, jid: string) {
  try {
    const r = RoutingRuleSchema.array().safeParse(JSON.parse(raw));
    if (!r.success) {
      logger.warn(
        { jid, errors: r.error.issues },
        'routing_rules schema invalid, ignoring',
      );
      return undefined;
    }
    return r.data;
  } catch {
    logger.warn({ jid }, 'routing_rules is not valid JSON, ignoring');
    return undefined;
  }
}

function rowToGroup(row: GroupRow): RegisteredGroup & { jid: string } {
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? parseContainerConfig(row.container_config, row.jid)
      : undefined,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    slinkToken: row.slink_token ?? undefined,
    parent: row.parent ?? undefined,
    routingRules: row.routing_rules
      ? parseRoutingRules(row.routing_rules, row.jid)
      : undefined,
  };
}

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as GroupRow | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return rowToGroup(row);
}

export function getGroupBySlink(
  token: string,
): (RegisteredGroup & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE slink_token = ?')
    .get(token) as GroupRow | undefined;
  if (!row) return undefined;
  return rowToGroup(row);
}

export function setRegisteredGroup(jid: string, group: RegisteredGroup): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  if (group.containerConfig !== undefined) {
    ContainerConfigSchema.parse(group.containerConfig);
  }
  if (group.routingRules !== undefined) {
    RoutingRuleSchema.array().parse(group.routingRules);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups
       (jid, name, folder, trigger_pattern, added_at, container_config,
        requires_trigger, slink_token, parent, routing_rules)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.containerConfig ? JSON.stringify(group.containerConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    group.slinkToken ?? null,
    group.parent ?? null,
    group.routingRules ? JSON.stringify(group.routingRules) : null,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db
    .prepare('SELECT * FROM registered_groups')
    .all() as GroupRow[];
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    const { jid: _jid, ...group } = rowToGroup(row);
    result[row.jid] = group;
  }
  return result;
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredGroup(jid, group);
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}

// --- Auth ---

export interface AuthUser {
  id: number;
  sub: string;
  username: string;
  hash: string;
  name: string;
  created_at: string;
}

export interface AuthSession {
  token_hash: string;
  user_sub: string;
  expires_at: string;
  created_at: string;
}

export function createAuthUser(
  sub: string,
  username: string,
  hash: string,
  name: string,
): AuthUser {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO auth_users (sub, username, hash, name, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sub, username, hash, name, now);
  return db
    .prepare<[string], AuthUser>(`SELECT * FROM auth_users WHERE sub = ?`)
    .get(sub)!;
}

export function getAuthUserBySub(sub: string): AuthUser | undefined {
  return (
    db
      .prepare<[string], AuthUser>(`SELECT * FROM auth_users WHERE sub = ?`)
      .get(sub) ?? undefined
  );
}

export function getAuthUserByUsername(username: string): AuthUser | undefined {
  return (
    db
      .prepare<
        [string],
        AuthUser
      >(`SELECT * FROM auth_users WHERE username = ?`)
      .get(username) ?? undefined
  );
}

export function createAuthSession(
  tokenHash: string,
  userSub: string,
  expiresAt: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, user_sub, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(tokenHash, userSub, expiresAt, now);
}

export function getAuthSession(tokenHash: string): AuthSession | undefined {
  return (
    db
      .prepare<
        [string],
        AuthSession
      >(`SELECT * FROM auth_sessions WHERE token_hash = ?`)
      .get(tokenHash) ?? undefined
  );
}

export function deleteAuthSession(tokenHash: string): void {
  db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(tokenHash);
}

export function pruneExpiredSessions(): void {
  db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).run(
    new Date().toISOString(),
  );
}

// --- Email thread accessors ---

export interface EmailThread {
  message_id: string;
  thread_id: string;
  from_address: string;
  root_msg_id: string;
  seen_at: string;
}

export function getEmailThread(threadId: string): EmailThread | undefined {
  return db
    .prepare('SELECT * FROM email_threads WHERE thread_id = ? LIMIT 1')
    .get(threadId) as EmailThread | undefined;
}

export function getEmailThreadByMsgId(
  messageId: string,
): EmailThread | undefined {
  return db
    .prepare('SELECT * FROM email_threads WHERE message_id = ?')
    .get(messageId) as EmailThread | undefined;
}

export function storeEmailThread(
  messageId: string,
  threadId: string,
  fromAddress: string,
  rootMsgId: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO email_threads
       (message_id, thread_id, from_address, root_msg_id, seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(messageId, threadId, fromAddress, rootMsgId, new Date().toISOString());
}
