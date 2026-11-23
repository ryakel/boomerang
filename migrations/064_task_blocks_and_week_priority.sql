-- Calendar blocks and week priorities (2026-11-23, BOOM-57 / BOOM-59).
--
-- A block is ONE Google Calendar event a task asked for: "one block = one
-- priority that needs focus time". It gets its own columns rather than
-- `gcal_event_id`, which means "this task was imported from / owns that event"
-- and drives import identity, the dedupe sweep and Today hiding the event.
-- A block must stay visible on Today as the task's focus time, so it can't
-- share that column.
--   block_event_id     the event's id on Google Calendar
--   block_calendar_id  the calendar it was created on
--   block_start        ISO instant the block starts
--   block_minutes      its length
--
-- `week_priority` is the local 'YYYY-MM-DD' Monday of the week this task was
-- picked as a priority for, in the Friday weekly review. A task column, not a
-- settings key or localStorage: it must hold on every device and survive the
-- whole-blob settings sync. A stale value is harmless: Today only shows the
-- current week's.
ALTER TABLE tasks ADD COLUMN block_event_id TEXT;
ALTER TABLE tasks ADD COLUMN block_calendar_id TEXT;
ALTER TABLE tasks ADD COLUMN block_start TEXT;
ALTER TABLE tasks ADD COLUMN block_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN week_priority TEXT;
