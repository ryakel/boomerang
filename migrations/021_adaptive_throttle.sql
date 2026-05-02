-- Adaptive throttling decisions and user feedback log.
--
-- Each row records a moment when getEffectiveThrottle() decided to back off
-- (or relax) the throttle for a (channel, type) combination based on the
-- last N notifications' tap/complete history.
--
-- The user can later mark a decision with feedback (thumbs up = "yes that
-- was right, keep going" or thumbs down = "no, undo this back-off, I want
-- those notifications back"). Thumbs-down sets user_overridden_until so
-- adaptive throttling stops auto-tuning that combination for a grace period.
CREATE TABLE IF NOT EXISTS throttle_decisions (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  multiplier_old REAL NOT NULL,
  multiplier_new REAL NOT NULL,
  decided_at TEXT NOT NULL,
  feedback TEXT,                   -- 'up' | 'down' | null
  feedback_at TEXT,
  user_overridden_until TEXT       -- when set, getEffectiveThrottle returns 1.0 for this combo until past timestamp
);
CREATE INDEX IF NOT EXISTS idx_throttle_decisions_decided_at ON throttle_decisions(decided_at);
CREATE INDEX IF NOT EXISTS idx_throttle_decisions_channel_type ON throttle_decisions(channel, type);
