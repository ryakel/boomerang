-- Routine Stacks: one routine that fans out into several independent task cards.
--
-- A "stack" is a routine with one or more MEMBERS. When the routine is due it
-- spawns one task per member (independent cards, checked off in any order, each
-- scoring its own points). Clearing every member of a cycle pays a bonus =
-- 20% of the cycle's combined member points. This is distinct from the
-- dependent follow-up chain (follow_ups_json), where step N spawns step N+1.
--
--   routines.members_json — JSON array of member templates:
--     [{ id, title, energy_type?, energy_level?, notes?, tags? }]
--     A routine is a stack iff this array is non-empty. NULL/[] = ordinary
--     single-task routine (unchanged behavior).
--
--   tasks.stack_bonus — the bonus points stamped on the single task that
--     completes a stack cycle (the one whose completion clears the last member).
--     Summed into the daily points total exactly like project session points.
--     NULL on every non-closing task.
ALTER TABLE routines ADD COLUMN members_json TEXT;
ALTER TABLE tasks ADD COLUMN stack_bonus INTEGER;
