CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  notes TEXT DEFAULT '',
  due_date TEXT,
  snoozed_until TEXT,
  snooze_count INTEGER DEFAULT 0,
  staleness_days INTEGER DEFAULT 2,
  last_touched TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  reframe_notes TEXT,
  notion_page_id TEXT,
  notion_url TEXT,
  trello_card_id TEXT,
  trello_card_url TEXT,
  routine_id TEXT,
  high_priority INTEGER DEFAULT 0,
  size TEXT,
  energy TEXT,
  energy_level INTEGER,
  tags_json TEXT DEFAULT '[]',
  attachments_json TEXT DEFAULT '[]',
  checklist_json TEXT DEFAULT '[]',
  comments_json TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_energy ON tasks(energy);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_routine_id ON tasks(routine_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);
