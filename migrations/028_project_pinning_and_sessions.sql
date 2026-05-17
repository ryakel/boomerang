-- 028: Project pinning, parent/child task hierarchy, session logging,
-- per-project nag control, and indefinite "later, fuck off" snooze.
--
-- parent_id        Self-FK; child task belongs to a project (or another task).
--                  NULL = standalone. Indexed for fast child lookup.
-- pinned_to_today  Project-level flag. When 1, the project surfaces as a
--                  "Pinned" section on the main task list. Independent of
--                  nags — pinning only affects visibility.
-- nag_allowed      Project-level toggle. When 1 AND no due date, calm
--                  notifications can fire. When a due date is set, normal
--                  nag rules apply regardless of this flag.
-- session_count    Count of "I worked on this" sessions logged for a project.
-- last_session_at  ISO timestamp of most recent session log.
-- session_log_json Array of { timestamp, points } session entries.
-- child_visibility 'active' | 'backstage' for child tasks. 'active' children
--                  surface in the main list under their parent project's
--                  pinned section. 'backstage' children are only visible
--                  when drilling into the project. Default 'backstage' so
--                  the main list stays calm by default.
-- snooze_indefinite Flag for "Until I come back" snooze — task stays in the
--                  Snoozed section without auto-resurfacing. snoozed_until
--                  is still set (to year 2099) for backward compatibility
--                  with existing snooze-filter logic.

ALTER TABLE tasks ADD COLUMN parent_id TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN pinned_to_today INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN nag_allowed INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN session_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN last_session_at TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN session_log_json TEXT DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN child_visibility TEXT DEFAULT 'backstage';
ALTER TABLE tasks ADD COLUMN snooze_indefinite INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(pinned_to_today);
