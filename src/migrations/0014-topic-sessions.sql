-- Add topic column to sessions for named topic sessions (#topic routing)
-- Change PK from group_folder to (group_folder, topic)
-- Add topic column to messages for future filtering

-- Recreate sessions table with topic support
CREATE TABLE IF NOT EXISTS sessions_new (
  group_folder TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  PRIMARY KEY (group_folder, topic)
);

INSERT OR IGNORE INTO sessions_new (group_folder, topic, session_id)
SELECT group_folder, '', session_id FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

-- Add topic column to messages (nullable, default empty string)
ALTER TABLE messages ADD COLUMN topic TEXT DEFAULT '';
