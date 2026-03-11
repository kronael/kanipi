-- Strip WhatsApp suffixes from chat JIDs
UPDATE chats SET jid = REPLACE(jid, '@g.us', '')
  WHERE jid LIKE 'whatsapp:%@g.us';
UPDATE chats SET jid = REPLACE(jid, '@s.whatsapp.net', '')
  WHERE jid LIKE 'whatsapp:%@s.whatsapp.net';

UPDATE messages SET chat_jid = REPLACE(chat_jid, '@g.us', '')
  WHERE chat_jid LIKE 'whatsapp:%@g.us';
UPDATE messages SET chat_jid = REPLACE(chat_jid, '@s.whatsapp.net', '')
  WHERE chat_jid LIKE 'whatsapp:%@s.whatsapp.net';

UPDATE routes SET jid = REPLACE(jid, '@g.us', '')
  WHERE jid LIKE 'whatsapp:%@g.us';
UPDATE routes SET jid = REPLACE(jid, '@s.whatsapp.net', '')
  WHERE jid LIKE 'whatsapp:%@s.whatsapp.net';

-- Clean up chat names that are just the raw JID (no real name set)
UPDATE chats SET name = NULL WHERE name = jid;

-- Strip WhatsApp suffixes from bare senders before prefixing
UPDATE messages SET sender = REPLACE(sender, '@g.us', '')
  WHERE sender LIKE '%@g.us';
UPDATE messages SET sender = REPLACE(sender, '@s.whatsapp.net', '')
  WHERE sender LIKE '%@s.whatsapp.net';
UPDATE messages SET sender = REPLACE(sender, '@lid', '')
  WHERE sender LIKE '%@lid';

-- Add platform prefix to sender for existing messages
UPDATE messages SET sender = 'telegram:' || sender
  WHERE chat_jid LIKE 'telegram:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'whatsapp:' || sender
  WHERE chat_jid LIKE 'whatsapp:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'discord:' || sender
  WHERE chat_jid LIKE 'discord:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'email:' || sender
  WHERE chat_jid LIKE 'email:%' AND sender NOT LIKE '%:%';
