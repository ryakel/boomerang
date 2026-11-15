-- Kept outside app_data so dev reseeding cannot erase alarm ownership/receipts.
CREATE TABLE IF NOT EXISTS alarm_rule_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL
);
