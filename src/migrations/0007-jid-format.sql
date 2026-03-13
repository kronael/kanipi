-- Add platform prefix to senders (no suffix stripping)
UPDATE messages SET sender = 'telegram:' || sender
  WHERE chat_jid LIKE 'telegram:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'whatsapp:' || sender
  WHERE chat_jid LIKE 'whatsapp:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'discord:' || sender
  WHERE chat_jid LIKE 'discord:%' AND sender NOT LIKE '%:%';
UPDATE messages SET sender = 'email:' || sender
  WHERE chat_jid LIKE 'email:%' AND sender NOT LIKE '%:%';
