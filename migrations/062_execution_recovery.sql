-- Private approved commands / queued messages; never returned in public receipts.
CREATE TABLE IF NOT EXISTS adviser_recovery_state (
  id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL
);
