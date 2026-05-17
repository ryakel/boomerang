-- 029: Per-task dependency list ("blocked_by") for project sub-tasks.
--
-- Each task gets an optional `blocked_by_json` array of sibling task IDs.
-- A sub is "blocked" when any of its blockers is not yet completed
-- (status != 'done'). Blocked subs are hidden from the main task list
-- (mobile and desktop) and only visible inside the Projects drill-down,
-- where they render with a "⏸ waits on X, Y" indicator.
--
-- Storage: JSON array of task IDs. Defaults to '[]' so the absence of
-- a dependency is the natural state.
--
-- Cycle protection lives in the UI + Quokka stagedValidate, not at the
-- DB layer — SQLite doesn't have a clean way to express "this column
-- must not transitively reference itself."

ALTER TABLE tasks ADD COLUMN blocked_by_json TEXT DEFAULT '[]';
