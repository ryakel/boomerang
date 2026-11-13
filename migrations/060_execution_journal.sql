CREATE TABLE IF NOT EXISTS adviser_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chat_id TEXT,
  revision TEXT NOT NULL,
  state TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, revision)
);
CREATE INDEX IF NOT EXISTS adviser_execution_chat ON adviser_executions(chat_id);
