-- Gmail integration: track processed email messages to avoid duplicates
CREATE TABLE IF NOT EXISTS gmail_processed (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT,
  subject TEXT,
  from_email TEXT,
  result_type TEXT, -- 'task', 'package', 'skipped', 'error'
  result_id TEXT,   -- task ID or package ID if created
  processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gmail_processed_at ON gmail_processed(processed_at);

-- Add Gmail source columns to tasks
ALTER TABLE tasks ADD COLUMN gmail_message_id TEXT;
ALTER TABLE tasks ADD COLUMN gmail_pending INTEGER DEFAULT 0;

-- Add Gmail source columns to packages
ALTER TABLE packages ADD COLUMN gmail_message_id TEXT;
ALTER TABLE packages ADD COLUMN gmail_pending INTEGER DEFAULT 0;
