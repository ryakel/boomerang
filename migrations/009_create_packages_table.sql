CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL,
  carrier TEXT,
  carrier_name TEXT DEFAULT '',
  label TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  status_detail TEXT DEFAULT '',
  eta TEXT,
  delivered_at TEXT,
  signature_required INTEGER DEFAULT 0,
  signature_task_id TEXT,
  last_location TEXT DEFAULT '',
  events_json TEXT DEFAULT '[]',
  last_polled TEXT,
  poll_interval_minutes INTEGER DEFAULT 120,
  auto_cleanup_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_tracking ON packages(tracking_number);
CREATE INDEX IF NOT EXISTS idx_packages_cleanup ON packages(auto_cleanup_at);
