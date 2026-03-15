import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, STORE_DIR } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import { createTestDatabase, ensureDatabase } from './migrations.js';
import {
  ContainerConfigSchema,
  InboundEvent,
  Route,
  ScheduledTask,
  TaskRunLog,
} from './types.js';

let db: Database.Database;
export function setDatabase(d: Database.Database): void {
  db = d;
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  db = ensureDatabase(dbPath);
  logger.info('Database initialized');
  migrateJsonState();
}

export function _initTestDatabase(): void {
  db = createTestDatabase();
}

export function _setRawGroupColumns(
  folder: string,
  cols: { container_config?: string },
): void {
  db.prepare(
    `INSERT OR REPLACE INTO groups
       (folder, name, added_at, container_config, parent, slink_token, max_children)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(
    folder,
    'test',
    '2024-01-01T00:00:00.000Z',
    cols.container_config ?? null,
  );
}

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

export function getLastGroupSync(): string | null {
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

export function markChatErrored(jid: string): void {
  db.prepare('UPDATE chats SET errored = 1 WHERE jid = ?').run(jid);
}

export function clearChatErrored(jid: string): void {
  db.prepare('UPDATE chats SET errored = 0 WHERE jid = ?').run(jid);
}

export function isChatErrored(jid: string): boolean {
  const row = db.prepare('SELECT errored FROM chats WHERE jid = ?').get(jid) as
    | { errored: number }
    | undefined;
  return row?.errored === 1;
}

export function appendMessageContent(id: string, suffix: string): void {
  db.prepare(`UPDATE messages SET content = content || ? WHERE id = ?`).run(
    suffix,
    id,
  );
}

export function storeMessage(msg: InboundEvent): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages
       (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message,
        forwarded_from, reply_to_text, reply_to_sender,
        reply_to_id, forwarded_from_id, forwarded_msgid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    msg.reply_to_id ?? null,
    msg.forwarded_from_id ?? null,
    msg.forwarded_msgid ?? null,
  );
}

export function getMessageById(id: string): InboundEvent | undefined {
  return db.prepare('SELECT * FROM messages WHERE id = ? LIMIT 1').get(id) as
    | InboundEvent
    | undefined;
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: InboundEvent[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp,
           forwarded_from, reply_to_text, reply_to_sender,
           reply_to_id, forwarded_from_id, forwarded_msgid
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders})
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as InboundEvent[];

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
): InboundEvent[] {
  const since = sinceTimestamp || '';
  const sql = `
    SELECT m.id, m.chat_jid, m.sender, m.sender_name, m.content, m.timestamp,
           m.forwarded_from, m.reply_to_text, m.reply_to_sender,
           m.reply_to_id, m.forwarded_from_id, m.forwarded_msgid,
           CASE WHEN c.is_group = 1 THEN c.name ELSE NULL END AS group_name
    FROM messages m
    LEFT JOIN chats c ON c.jid = m.chat_jid
    WHERE m.chat_jid = ? AND m.timestamp > ?
      AND m.is_bot_message = 0 AND m.content NOT LIKE ?
      AND m.content != '' AND m.content IS NOT NULL
    ORDER BY m.timestamp DESC
    LIMIT ?
  `;
  const rows = db
    .prepare(sql)
    .all(chatJid, since, `${botPrefix}:%`, MSG_LIMIT) as InboundEvent[];
  return rows.reverse();
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, command, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.command ?? null,
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

export function getGroupBySlink(
  token: string,
): (GroupConfig & { jid: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM groups WHERE slink_token = ?')
    .get(token) as GroupsRow | undefined;
  if (!row) return undefined;

  // Find a JID that routes to this folder
  const route = db
    .prepare(
      "SELECT jid FROM routes WHERE target = ? AND type = 'default' LIMIT 1",
    )
    .get(row.folder) as { jid: string } | undefined;

  // Web groups may not have routes yet if just created
  const jid = route?.jid ?? `web:${row.folder}`;
  return { ...rowToGroupConfig(row), jid };
}

export function _setTestGroupRoute(
  jid: string,
  group: { name: string; folder: string } & Partial<
    Omit<GroupConfig, 'name' | 'folder'>
  >,
): void {
  const fullConfig: GroupConfig = {
    name: group.name,
    folder: group.folder,
    added_at: group.added_at ?? new Date().toISOString(),
    containerConfig: group.containerConfig,
    slinkToken: group.slinkToken,
    parent: group.parent,
    maxChildren: group.maxChildren,
  };
  setGroupConfig(fullConfig);
  const existing = db
    .prepare("SELECT id FROM routes WHERE jid = ? AND type = 'default'")
    .get(jid);
  if (!existing) {
    addRoute(jid, {
      seq: 0,
      type: 'default',
      match: null,
      target: group.folder,
    });
  }
}

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
}

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

export function deleteAuthSessionsByUserSub(userSub: string): void {
  db.prepare(`DELETE FROM auth_sessions WHERE user_sub = ?`).run(userSub);
}

export function pruneExpiredSessions(): void {
  db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).run(
    new Date().toISOString(),
  );
}

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

type RouteRow = {
  id: number;
  jid: string;
  seq: number;
  type: string;
  match: string | null;
  target: string;
  command: string | null;
};

function rowToRoute(row: RouteRow): Route {
  return {
    id: row.id,
    jid: row.jid,
    seq: row.seq,
    type: row.type as Route['type'],
    match: row.match,
    target: row.target,
    command: row.command,
  };
}

export function getRoutesForJid(jid: string): Route[] {
  const rows = db
    .prepare('SELECT * FROM routes WHERE jid = ? ORDER BY seq ASC')
    .all(jid) as RouteRow[];
  return rows.map(rowToRoute);
}

export function getAllRoutes(): Route[] {
  const rows = db
    .prepare('SELECT * FROM routes ORDER BY jid, seq ASC')
    .all() as RouteRow[];
  return rows.map(rowToRoute);
}

export function getRoutedJids(): string[] {
  const rows = db.prepare('SELECT DISTINCT jid FROM routes').all() as {
    jid: string;
  }[];
  return rows.map((r) => r.jid);
}

export function setRoutesForJid(
  jid: string,
  routes: (Omit<Route, 'id' | 'jid' | 'command'> & {
    command?: string | null;
  })[],
): void {
  db.prepare('DELETE FROM routes WHERE jid = ?').run(jid);
  const insert = db.prepare(
    'INSERT INTO routes (jid, seq, type, match, target, command) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const r of routes) {
    insert.run(jid, r.seq, r.type, r.match, r.target, r.command ?? null);
  }
}

export function addRoute(
  jid: string,
  route: Omit<Route, 'id' | 'jid' | 'command'> & { command?: string | null },
): number {
  const result = db
    .prepare(
      'INSERT INTO routes (jid, seq, type, match, target, command) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      jid,
      route.seq,
      route.type,
      route.match,
      route.target,
      route.command ?? null,
    );
  return result.lastInsertRowid as number;
}

export function getRouteById(id: number): Route | undefined {
  const row = db.prepare('SELECT * FROM routes WHERE id = ?').get(id) as
    | RouteRow
    | undefined;
  return row ? rowToRoute(row) : undefined;
}

export function deleteRoute(id: number): void {
  db.prepare('DELETE FROM routes WHERE id = ?').run(id);
}

export function getJidsForFolder(folder: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT jid FROM routes WHERE target = ?')
    .all(folder) as { jid: string }[];
  return rows.map((r) => r.jid);
}

export function getHubForJid(jid: string): string | null {
  const row = db
    .prepare(
      `SELECT target FROM routes WHERE jid = ? AND type = 'default' ORDER BY seq LIMIT 1`,
    )
    .get(jid) as { target: string } | undefined;
  if (!row) return null;
  // Template targets like "atlas/{sender}" — return base folder (hub)
  if (row.target.includes('{')) {
    const slash = row.target.lastIndexOf('/');
    return slash > 0 ? row.target.slice(0, slash) : null;
  }
  return row.target;
}

export function getRouteTargetsForJid(jid: string): string[] {
  const rows = db
    .prepare('SELECT DISTINCT target FROM routes WHERE jid = ?')
    .all(jid) as { target: string }[];
  return rows.map((r) => {
    if (r.target.includes('{')) {
      const slash = r.target.lastIndexOf('/');
      return slash > 0 ? r.target.slice(0, slash) : r.target;
    }
    return r.target;
  });
}

export function getDirectChildGroupCount(parentFolder: string): number {
  const depth = parentFolder.split('/').length + 1;
  const rows = db
    .prepare('SELECT folder FROM groups WHERE folder LIKE ?')
    .all(`${parentFolder}/%`) as { folder: string }[];
  return rows.filter((r) => r.folder.split('/').length === depth).length;
}

type GroupsRow = {
  folder: string;
  name: string;
  added_at: string;
  container_config: string | null;
  parent: string | null;
  slink_token: string | null;
  max_children: number | null;
};

export interface GroupConfig {
  folder: string;
  name: string;
  added_at: string;
  containerConfig?: import('./types.js').ContainerConfig;
  parent?: string;
  slinkToken?: string;
  maxChildren?: number;
}

function parseContainerConfig(raw: string, key: string) {
  try {
    const r = ContainerConfigSchema.safeParse(JSON.parse(raw));
    if (!r.success) {
      logger.warn(
        { key, errors: r.error.issues },
        'container_config schema invalid, ignoring',
      );
      return undefined;
    }
    return r.data;
  } catch {
    logger.warn({ key }, 'container_config is not valid JSON, ignoring');
    return undefined;
  }
}

function rowToGroupConfig(row: GroupsRow): GroupConfig {
  return {
    folder: row.folder,
    name: row.name,
    added_at: row.added_at,
    containerConfig: row.container_config
      ? parseContainerConfig(row.container_config, row.folder)
      : undefined,
    parent: row.parent ?? undefined,
    slinkToken: row.slink_token ?? undefined,
    maxChildren: row.max_children ?? undefined,
  };
}

export function getGroupByFolder(folder: string): GroupConfig | undefined {
  const row = db
    .prepare('SELECT * FROM groups WHERE folder = ?')
    .get(folder) as GroupsRow | undefined;
  if (!row) return undefined;
  return rowToGroupConfig(row);
}

export function getAllGroupConfigs(): Record<string, GroupConfig> {
  const rows = db.prepare('SELECT * FROM groups').all() as GroupsRow[];
  const result: Record<string, GroupConfig> = {};
  for (const row of rows) {
    result[row.folder] = rowToGroupConfig(row);
  }
  return result;
}

export function setGroupConfig(config: GroupConfig): void {
  if (!isValidGroupFolder(config.folder)) {
    throw new Error(`Invalid group folder "${config.folder}"`);
  }
  if (config.containerConfig !== undefined) {
    ContainerConfigSchema.parse(config.containerConfig);
  }
  db.prepare(
    `INSERT OR REPLACE INTO groups
       (folder, name, added_at, container_config, parent, slink_token, max_children)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    config.folder,
    config.name,
    config.added_at,
    config.containerConfig ? JSON.stringify(config.containerConfig) : null,
    config.parent ?? null,
    config.slinkToken ?? null,
    config.maxChildren ?? null,
  );
}

export function deleteGroupConfig(folder: string): void {
  db.prepare('DELETE FROM groups WHERE folder = ?').run(folder);
}
