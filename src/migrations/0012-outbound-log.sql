-- Add outbound metadata columns to messages table
ALTER TABLE messages ADD COLUMN source TEXT;
ALTER TABLE messages ADD COLUMN group_folder TEXT;
