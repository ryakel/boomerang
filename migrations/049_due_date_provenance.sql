-- 049: provenance for automatically-shifted due dates (Away mode bulk repair).
--
-- The rule (CLAUDE.md, data durability): a system-moved date must be explicable
-- from the task row ALONE. The away window that justified the move lives in
-- app_data and is routinely replaced by the next trip — and the packages
-- feature's rows self-delete — so provenance derived by joining to the mover is
-- provenance scheduled to vanish. Stamp it on the task at the moment the date
-- moves, and "did I set this date or did the system?" stays answerable forever.
--
-- due_date_original keeps the FIRST pre-shift date and is never overwritten by
-- later shifts: the value worth preserving is what the human last chose.

ALTER TABLE tasks ADD COLUMN due_date_original TEXT;
ALTER TABLE tasks ADD COLUMN due_shifted_at TEXT;
ALTER TABLE tasks ADD COLUMN due_shifted_reason TEXT;
