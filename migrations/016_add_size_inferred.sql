-- Add size_inferred column to tasks (default 0 = needs inference)
-- When 1, the task has been successfully auto-sized (or manually sized by user)
-- and the background auto-sizer should leave it alone.
-- Existing tasks with a size are treated as already-inferred so we don't
-- re-run inference against them.
ALTER TABLE tasks ADD COLUMN size_inferred INTEGER DEFAULT 0;
UPDATE tasks SET size_inferred = 1 WHERE size IS NOT NULL;
