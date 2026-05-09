-- Add follow_ups_json column to tasks and routines for completion-triggered task chains.
-- Each row holds a JSON array of step descriptors:
--   [{id, title, offset_minutes, energy_type?, energy_level?, notes?}]
-- On a routine, this is the template — copied onto each spawned instance.
-- On a task, this is the live remaining chain — walked as each step completes.
ALTER TABLE tasks ADD COLUMN follow_ups_json TEXT DEFAULT '[]';
ALTER TABLE routines ADD COLUMN follow_ups_json TEXT DEFAULT '[]';
