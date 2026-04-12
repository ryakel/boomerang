-- Add low_priority column to tasks (default 0 = not low priority)
ALTER TABLE tasks ADD COLUMN low_priority INTEGER DEFAULT 0;
