-- Shared lists (2026-07-27): a list is a set of items kept in bidirectional
-- sync with a checklist on a Trello card. Born of the grocery list — it lives
-- on someone else's card, both people edit it, and the goal is never opening
-- Trello again.
--
-- Deliberately NOT tasks. A grocery item has no due date, energy, impact, size
-- or rollover, and forty of them would drown the task list. Their own tables
-- also keep them out of the nightly rollover, the notification pools, the
-- analytics buckets and the /api/data wipe guard — the same carve-out
-- reasoning as notes (044) and packages.

CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'shopping',

  -- Trello linkage. A list with no card is simply local-only and never syncs,
  -- so an unlinked list is a valid state rather than a broken one.
  trello_card_id TEXT,
  trello_checklist_id TEXT,
  sync_enabled INTEGER NOT NULL DEFAULT 1,

  -- Observability for a sync that runs unattended. A silent sync that has been
  -- failing for a week is worse than one that never ran.
  last_synced_at TEXT,
  last_sync_error TEXT,

  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  position REAL NOT NULL DEFAULT 0,
  trello_check_item_id TEXT,

  -- THE 3-WAY MERGE BASELINE, and the reason this table exists rather than a
  -- JSON blob. shadow_* is what Boomerang and Trello last AGREED on, written
  -- only at the end of a successful sync. Comparing local and remote against
  -- it *separately* is what distinguishes "I changed this" from "she changed
  -- this" from "we both did". A two-way diff cannot tell those apart and
  -- collapses into last-writer-wins, which on a list two people edit means
  -- silently eating the other person's edit.
  --
  -- NULL shadow = never synced, i.e. a local add still waiting to be pushed.
  shadow_name TEXT,
  shadow_checked INTEGER,

  -- Tombstone. Items are soft-deleted so the sync can tell "deleted here, push
  -- the delete" apart from "never existed here". A hard delete is
  -- indistinguishable from an item Trello simply hasn't sent us yet, so the
  -- next poll would faithfully resurrect it.
  deleted_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_trello ON list_items(trello_check_item_id);
CREATE INDEX IF NOT EXISTS idx_lists_card ON lists(trello_card_id);
