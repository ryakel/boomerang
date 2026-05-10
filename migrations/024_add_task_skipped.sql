-- Sequences PR 3: skipped flag on tasks. Set when the user clicks the
-- "Skip & advance" button on a chain-step task — the task is marked
-- cancelled (so it stops appearing in active lists) AND skipped=1, and
-- spawnNextChainStep runs anyway so the chain keeps walking.
--
-- DoneList, ActivityLog, and analytics can distinguish a true cancellation
-- (user gave up on the work) from a skip (user advanced the chain past
-- this step) by filtering on this column.
ALTER TABLE tasks ADD COLUMN skipped INTEGER DEFAULT 0;
