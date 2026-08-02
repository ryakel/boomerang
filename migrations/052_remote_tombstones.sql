-- Remote tombstones (2026-08-01).
--
-- Reported as "why do these keep coming back??" — three Notion-linked tasks
-- that reappeared in Anytime after every delete.
--
-- Cause: every sync-in path creates a task for any remote item with no
-- matching local task, and none of them recorded that a task had been deleted
-- on purpose. Notion is the sharpest case because the database-row pull has no
-- guard at all (useNotionSync.js) — the page-based pull at least skips a page
-- whose last_edited is unchanged, but the row pull re-imports unconditionally.
-- And unlike Trello, deleting a Notion-linked task does not archive anything
-- upstream, so the row survives and the task is guaranteed to return.
--
-- This is the same trap already pinned in CLAUDE.md for LIST items ("a hard
-- delete is indistinguishable from an item Trello hasn't sent yet, so the next
-- poll resurrects it"). It was never applied to tasks.
--
-- A tombstone is a durable statement of intent: "I deleted this on purpose,
-- stop bringing it back." It lives on the SERVER rather than in localStorage
-- because that intent has to survive a reinstall, a cache clear and a second
-- device — a per-device dismissal would resurrect everything the first time
-- you open Boomerang somewhere new.
CREATE TABLE IF NOT EXISTS remote_tombstones (
  -- 'notion' | 'trello' | 'gcal'. Kept generic rather than one table per
  -- integration: all three have the identical hole, and a new integration
  -- should inherit the protection instead of rediscovering the bug.
  source TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  -- What it was, so a human reading the table can tell what they killed.
  title TEXT,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (source, remote_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_tombstones_source ON remote_tombstones(source);
