-- WebDAV workspace access: token hash and group access list per user
ALTER TABLE auth_users ADD COLUMN webdav_token_hash TEXT;
ALTER TABLE auth_users ADD COLUMN webdav_groups TEXT NOT NULL DEFAULT '["root"]';
