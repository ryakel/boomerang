-- Link scope (2026-07-27): sync a CARD or a COLUMN, not just one checklist.
--
-- Measured against the live board, the family's structure is:
--
--   Column "Shopping"                    <- grouping level 1
--   +-- Card "2026 Groceries"            <- grouping level 2
--   |   +-- Checklist "Grocery"  -> items
--   |   +-- Checklist "Checklist 2"
--   +-- Card "Costco"        +-- Checklist -> items
--   +-- Card "Trader Joe's"  +-- Checklist -> items
--
-- A Boomerang list REMAINS a Trello checklist -- that is where items live, and
-- listMerge.js is untouched by any of this. What changes is how lists come to
-- exist: instead of a person pinning one checklist by hand, they link a
-- container and Boomerang materializes one list per checklist inside it.
--
-- WHY: auto-discovery, which is the whole point of the feature. Before this, a
-- checklist or a store card added on the Trello side was simply never seen --
-- "never open Trello again" quietly stopped being true and nothing said so.
--
-- Expansion (which checklists should exist) is deliberately a SEPARATE concern
-- from merge (what the items inside one checklist should say). listMerge.js
-- stays pure and stays pinned by its own tests; all of the new reasoning lives
-- in listExpand.js with tests of its own.

CREATE TABLE IF NOT EXISTS list_sources (
  id TEXT PRIMARY KEY,

  -- 'checklist' (one list, no discovery) | 'card' (one list per checklist on
  -- it) | 'column' (one list per checklist on every card in it).
  scope TEXT NOT NULL,

  -- The Trello id of the linked container. Which object it names depends on
  -- scope. NOTE the vocabulary trap: Trello's "list" is the board COLUMN,
  -- while Boomerang's "list" is a Trello CHECKLIST. Column ids are what
  -- Trello's API calls idList.
  trello_id TEXT NOT NULL,

  -- Cached display label so the UI can name the source without a fetch.
  name TEXT,

  -- Board context, for breadcrumbs and for re-finding a moved card.
  trello_board_id TEXT,

  sync_enabled INTEGER NOT NULL DEFAULT 1,

  -- Observability, mirroring lists.last_sync_*. An expansion that has been
  -- failing silently is exactly as bad as a merge that has -- it means new
  -- checklists stopped appearing and nothing said so.
  last_expanded_at TEXT,
  last_expand_error TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Which source materialized a list. NULL means the list was created by hand
-- (local-only, or a checklist pinned directly) and expansion must leave it
-- alone -- a source must never adopt or orphan a list it did not create.
ALTER TABLE lists ADD COLUMN source_id TEXT;

-- The board column the list's card sits in. Named _column_, never _list_,
-- because Trello's "list" means the column and this codebase's "list" does
-- not. Cached names alongside so the UI renders
-- "Shopping / 2026 Groceries / Grocery" without extra fetches.
ALTER TABLE lists ADD COLUMN trello_column_id TEXT;
ALTER TABLE lists ADD COLUMN trello_column_name TEXT;
ALTER TABLE lists ADD COLUMN trello_card_name TEXT;

-- 3-way baseline for the list's OWN name, for the same reason list_items has
-- one: with only a two-way compare there is no way to tell "I renamed this
-- list in Boomerang" from "she renamed the checklist in Trello", and the
-- feature would silently pick a side. NULL = never agreed on a name yet.
ALTER TABLE lists ADD COLUMN shadow_name TEXT;

-- Set when a list's checklist stopped appearing in its source's expansion.
-- A TOMBSTONE, not a delete: the same reasoning as list_items.deleted_at.
-- A checklist missing from one poll is indistinguishable from a checklist
-- Trello just didn't return, so the row is kept and flagged, and the user
-- decides. Nothing is ever removed from Trello because of this.
ALTER TABLE lists ADD COLUMN orphaned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_lists_source ON lists(source_id);
CREATE INDEX IF NOT EXISTS idx_lists_column ON lists(trello_column_id);
CREATE INDEX IF NOT EXISTS idx_list_sources_trello ON list_sources(trello_id);
