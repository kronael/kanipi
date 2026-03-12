ALTER TABLE messages ADD COLUMN reply_to_id TEXT;
ALTER TABLE messages ADD COLUMN forwarded_from_id TEXT;
ALTER TABLE messages ADD COLUMN forwarded_msgid TEXT;
