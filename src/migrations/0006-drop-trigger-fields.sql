-- Convert default routes targeting trigger-required groups to trigger type
UPDATE routes SET type = 'trigger'
WHERE type = 'default'
  AND target IN (SELECT folder FROM groups WHERE requires_trigger = 1);

-- Drop dead columns
ALTER TABLE groups DROP COLUMN trigger_pattern;
ALTER TABLE groups DROP COLUMN requires_trigger;
