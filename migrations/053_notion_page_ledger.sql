-- Notion page ledger (2026-08-17).
--
-- Reported as "why are quokka prompts bleeding into tasks again??" — five
-- tasks appeared in Anytime after a Quokka session whose only job was
-- rewriting one Notion reference page.
--
-- Cause: the page-based pull (useNotionSync.js) runs an AI extractor
-- (analyzeNotionPage — "one page might produce 0-5 tasks") over any child of
-- notion_sync_parent_id whose last_edited_time has moved, and syncNotion()
-- fires on mount AND on every visibilitychange. So EDITING a page is the
-- trigger, and the thing doing most of the editing is Boomerang itself:
-- Quokka writes reference material to Notion because it was asked to, then
-- the sync reads it back and invents tasks out of it.
--
-- Two durable facts fix that, and both have to be DURABLE — the only guard
-- that existed was `boom_notion_page_cache` in localStorage, which iOS evicts
-- on a PWA (the same eviction that forced Quokka's chats server-side). When
-- it goes, every page under the sync parent looks brand new and the whole
-- parent gets re-mined at up to five tasks each, with Quokka nowhere near it.
--
--   authored_by = 'app'  Boomerang wrote or rewrote this page. It is NEVER a
--                        task source. Provenance, not shape: this holds for a
--                        knowledge page too big for one line exactly as it
--                        holds for a formal knowledge-database row, so nobody
--                        has to file their reference material a particular way
--                        to be safe from the extractor.
--
--   analyzed_at          The extractor has already considered this page. Once
--                        set it is never reconsidered, however many times the
--                        page is edited afterwards. A page earns exactly one
--                        look, when it first appears.
--
-- Pages present at upgrade time are baselined as analyzed without being read
-- (see NOTION_LEDGER_BASELINE_KEY in useNotionSync.js) — otherwise shipping an
-- empty ledger would make every existing page look new and fire the exact
-- flood this table exists to prevent.
CREATE TABLE IF NOT EXISTS notion_page_ledger (
  page_id TEXT PRIMARY KEY,
  -- 'app' = Boomerang authored/rewrote it. NULL = provenance unknown, which
  -- means the user wrote it in Notion (or it predates this ledger).
  authored_by TEXT,
  authored_at TEXT,
  analyzed_at TEXT,
  -- So a human reading the table can tell what each row is.
  title TEXT
);

CREATE INDEX IF NOT EXISTS idx_notion_ledger_authored ON notion_page_ledger(authored_by);
