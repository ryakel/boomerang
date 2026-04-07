-- Email notification throttle tracking (server-side, replaces localStorage)
CREATE TABLE IF NOT EXISTS notification_throttle (
  key TEXT PRIMARY KEY,
  last_sent TEXT NOT NULL
);

-- Email notification log (server-side)
CREATE TABLE IF NOT EXISTS notification_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  task_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at ON notification_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_type ON notification_log(type);
