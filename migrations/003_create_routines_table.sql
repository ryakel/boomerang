CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cadence TEXT NOT NULL,
  custom_days INTEGER,
  notes TEXT DEFAULT '',
  high_priority INTEGER DEFAULT 0,
  energy TEXT,
  energy_level INTEGER,
  notion_page_id TEXT,
  notion_url TEXT,
  created_at TEXT NOT NULL,
  paused INTEGER DEFAULT 0,
  tags_json TEXT DEFAULT '[]',
  completed_history_json TEXT DEFAULT '[]'
);
