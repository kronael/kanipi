CREATE TABLE IF NOT EXISTS onboarding (
  jid        TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  sender     TEXT,
  channel    TEXT,
  world_name TEXT,
  created    TEXT NOT NULL
);
