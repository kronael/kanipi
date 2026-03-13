-- Add platform prefix to senders (no suffix stripping)
UPDATE messages SET sender = 'telegram:' || sender
  WHERE chat_jid LIKE 'telegram:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'whatsapp:' || sender
  WHERE chat_jid LIKE 'whatsapp:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'discord:' || sender
  WHERE chat_jid LIKE 'discord:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'email:' || sender
  WHERE chat_jid LIKE 'email:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'web:' || sender
  WHERE chat_jid LIKE 'web:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'reddit:' || sender
  WHERE chat_jid LIKE 'reddit:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'twitter:' || sender
  WHERE chat_jid LIKE 'twitter:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'mastodon:' || sender
  WHERE chat_jid LIKE 'mastodon:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'bluesky:' || sender
  WHERE chat_jid LIKE 'bluesky:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'facebook:' || sender
  WHERE chat_jid LIKE 'facebook:%' AND sender NOT LIKE '%:%';
