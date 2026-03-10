-- Flat routing table: separate groups (folder config) from routes (JID routing)

-- Create groups table (folder is the primary key, not JID)
CREATE TABLE IF NOT EXISTS groups (
  folder TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  added_at TEXT NOT NULL,
  container_config TEXT,
  parent TEXT,
  trigger_pattern TEXT NOT NULL DEFAULT '',
  requires_trigger INTEGER DEFAULT 1,
  slink_token TEXT,
  max_children INTEGER DEFAULT 50
);

-- Create routes table (flat routing rules)
CREATE TABLE IF NOT EXISTS routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'default',
  match TEXT,
  target TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routes_jid_seq ON routes(jid, seq);

-- Migrate data from registered_groups -> groups
INSERT OR IGNORE INTO groups (folder, name, added_at, container_config, parent,
                              trigger_pattern, requires_trigger, slink_token, max_children)
SELECT folder, name, added_at, container_config, parent,
       COALESCE(trigger_pattern, ''), COALESCE(requires_trigger, 1),
       slink_token, COALESCE(max_children, 50)
FROM registered_groups;

-- Create default routes: each JID gets a default route to its folder
-- Complex routing_rules JSON expansion is handled in db.ts
INSERT OR IGNORE INTO routes (jid, seq, type, match, target)
SELECT jid, 0, 'default', NULL, folder
FROM registered_groups
WHERE jid NOT LIKE 'virtual:%';
