-- Activity Prompts PR 2: habit mode on routines.
--
-- Habit-shaped routines aren't cadence-locked schedules — they're target
-- frequencies. "Workout 2x/week" is the canonical case. No auto-spawn;
-- the user proactively clicks "+ Log it" on the always-visible routine
-- card (or accepts the behind-pace push nudge), which creates and
-- immediately completes a task linked to the routine. The completion
-- count per period drives the streak.
--
-- spawn_mode: 'auto' (default, today's cadence-driven behavior) or 'habit'
-- target_count: how many completions per period (e.g. 2). NULL when not habit.
-- target_period: 'week' or 'month'. NULL when not habit.
--
-- When spawn_mode='habit', cadence + schedule_day_of_week + auto_roll are
-- all ignored — habit routines don't have a "next due date." The Routines
-- screen renders them with a progress meter ("1/2 this week") and a
-- streak count of consecutive periods that hit target.
--
-- Full spec in wiki/Activity-Prompts.md.
ALTER TABLE routines ADD COLUMN spawn_mode TEXT DEFAULT 'auto';
ALTER TABLE routines ADD COLUMN target_count INTEGER;
ALTER TABLE routines ADD COLUMN target_period TEXT;
