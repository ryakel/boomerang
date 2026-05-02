-- Track engagement on notifications: did the user tap the deep link, and did
-- the referenced task get completed in the wake of the notification?
-- These two columns are the foundation for engagement analytics so we can
-- measure whether notifications actually pull the user back into the app to
-- act on tasks (the North Star), not just whether they were delivered.
ALTER TABLE notification_log ADD COLUMN tapped_at TEXT;
ALTER TABLE notification_log ADD COLUMN completed_after TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_log_task_id ON notification_log(task_id);
