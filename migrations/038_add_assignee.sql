-- Assignee: track loops/tasks that are for someone else the user supervises
-- (e.g. a kid's chore) rather than the user's own task. Purely informational
-- (this app has no multi-user accounts) — a free-text name shown as a chip
-- on the card. NULL/empty = "mine" (unchanged behavior).
--
-- routines.assignee  Set on the routine template; propagated onto each
--                     spawned task at spawn time (spawnDueTasks/spawnNow),
--                     same pattern as energy_type/energy_level.
-- tasks.assignee      Also settable directly on a one-off task (no routine
--                     required) for an ad-hoc chore.
--
-- Scoring: an assigned task/routine still counts toward the user's own daily
-- points/streak (per user decision — they're supervising it), but scores a
-- flat 1 point per completion instead of the size x energy x speed formula,
-- since it's a simple did-it-or-didn't chore rather than graded effort.
ALTER TABLE routines ADD COLUMN assignee TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN assignee TEXT DEFAULT NULL;
