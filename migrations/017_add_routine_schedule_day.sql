-- Add schedule_day_of_week column to routines (0=Sun, 6=Sat, NULL=no constraint).
-- When set, the routine's next-due date is computed by adding the cadence
-- interval and then snapping forward to the first occurrence of this weekday.
-- Example: weekly + 5 (Friday) → spawn every Friday.
-- Example: quarterly + 6 (Saturday) → spawn on the first Saturday after the
-- 3-month mark (may drift up to 6 days from the exact quarter).
ALTER TABLE routines ADD COLUMN schedule_day_of_week INTEGER DEFAULT NULL;
