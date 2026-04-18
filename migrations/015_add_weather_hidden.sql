-- Add weather_hidden column to tasks (default 0 = not hidden)
-- When 1, the weather UI on this task collapses into a drawer regardless of
-- auto-detect. Tags named "outside" still force-show; "inside" still forces
-- drawer. This column is the per-card override set via the X on the card or
-- the checkbox in EditTaskModal.
ALTER TABLE tasks ADD COLUMN weather_hidden INTEGER DEFAULT 0;
