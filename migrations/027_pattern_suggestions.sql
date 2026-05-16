-- Activity Prompts PR 3: historic-pattern suggestions.
--
-- Server-side table populated by patternDetection.js's weekly scan. Each
-- row represents a normalized-title cluster the user has completed at a
-- detected cadence (weekly / monthly / quarterly / annually) over the
-- previous 12 months. The user accepts → it becomes a routine, dismisses
-- → it's hidden permanently, or snoozes → resurfaces after snooze_until.
--
-- Lives server-side ONLY and is NOT in the bulk-PUT path used by
-- /api/data. Same posture as notification_log + the 2026-05-08 wipe
-- guard: a future wipe of the tasks table can't take suggestions with it.
-- The user can't accidentally bulk-replace this table from a client.
--
-- Full spec: wiki/Activity-Prompts.md.
CREATE TABLE IF NOT EXISTS pattern_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_title TEXT NOT NULL,
  display_title TEXT NOT NULL,
  sample_titles_json TEXT,          -- JSON array of all titles in the cluster
  detected_cadence TEXT NOT NULL,   -- daily|weekly|monthly|quarterly|annually
  occurrence_count INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,    -- epoch ms of most recent completion
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|dismissed
  snooze_until INTEGER,             -- epoch ms; "Not yet" sets this. NULL = no snooze.
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pattern_suggestions_status ON pattern_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_pattern_suggestions_normalized ON pattern_suggestions(normalized_title);
