-- Server-side activity log (2026-08-31).
--
-- Reported as "activity logs are completely empty so that's a bug too", from a
-- prod session whose database holds 1500 tasks.
--
-- The log lived ONLY in localStorage (`boom_activity_log_v1`, 500 entries, each
-- carrying a near-full task snapshot) and it is QUOTA_EVICT_KEYS[0] in
-- safeSetItem — literally the first thing thrown away when any other write hits
-- the quota. On the capacitor:// origin, whose quota is small, a database that
-- size is permanently over: the log gets evicted, rebuilt an entry at a time,
-- and evicted again, with only a console.warn nobody reads.
--
-- Two things were wrong with that placement, not just one:
--
--   1. The activity log is the RECOVERY log — the thing you open when sync
--      appears to have eaten a change. It was being discarded precisely when
--      storage pressure (many tasks, heavy churn) makes that question likely.
--      A recovery record that is first in the eviction queue is not a record.
--
--   2. It was per-device. Work done on the desktop was invisible in the phone's
--      log, for a user who works across both — which is also how the sync bugs
--      this log exists to diagnose show up in the first place.
--
-- Same ruling the codebase has already made twice: Quokka's chats moved
-- server-side because iOS evicts localStorage on a PWA, and the Notion page
-- ledger moved server-side with the note that any future durable client fact
-- belongs on the server for the same reason.
--
-- The local copy stays, as a render buffer, and stays evictable — that is what
-- it is for. What changes is that eviction no longer means "gone forever".
--
-- `id` is the client-generated uuid, so a replayed batch is idempotent
-- (INSERT OR IGNORE) rather than duplicating entries.
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  -- 'created' | 'completed' | 'deleted' | 'status_changed' | 'edited' |
  -- 'snoozed' | 'priority_changed' | 'reopened' | 'skipped' |
  -- 'session_logged' | 'escalation_attempt_logged' | 'escalation_resolved' |
  -- 'error'
  action TEXT NOT NULL,
  task_id TEXT,
  task_title TEXT,
  -- Bounded JSON snapshot for restore. Attachments are reduced to a count and
  -- notes are capped before this is written; see slimSnapshot in src/store.js.
  task_snapshot TEXT,
  timestamp TEXT NOT NULL
);

-- The log is read newest-first and pruned oldest-first; both want this.
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp DESC);
