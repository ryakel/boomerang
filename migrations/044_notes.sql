-- Notes (2026-07-18): free-floating notes — a place to leave a thought
-- without creating a task. No due date, no status, no points, no nagging;
-- deliberately NOT columns on the tasks table so notes can never leak into
-- notification pools, pile-up counts, or analytics. `pinned` notes surface
-- as a sticky strip at the top of Today (leave-a-note-on-the-fridge model);
-- unpinned notes live only in the Notes surface.
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  pinned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned);
