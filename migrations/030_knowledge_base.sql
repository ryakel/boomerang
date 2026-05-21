-- 030: Knowledge base — Notion-backed long-term reference store.
--
-- Each knowledge item lives as a Notion page in a user-owned database.
-- Boomerang keeps a server-side cache (`knowledge_index`) of just the
-- metadata (title, type, tags, summary≤200ch) so Quokka can search it
-- without round-tripping to Notion on every query. Full body is fetched
-- on demand via the Notion MCP when the user opens a specific item.
--
-- Schema mirrors the Notion database properties:
--   Title (string)
--   Type (select: Location | How-to | Decision | Person)
--   Tags (multi-select, freeform — stored as JSON array)
--   Related tasks (text — comma-sep task IDs; mirrors tasks.knowledge_page_ids
--     so we can render the relationship from either side)
--   Confidence (select: Certain | Fuzzy)
--
-- Tasks gain a `knowledge_page_ids_json` column (JSON array of Notion page
-- IDs) so the link is durable on both sides — the task knows what it
-- references, and the knowledge item knows what references it.

CREATE TABLE IF NOT EXISTS knowledge_index (
  notion_page_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT,
  tags_json TEXT DEFAULT '[]',
  summary TEXT DEFAULT '',
  confidence TEXT,
  related_task_ids_json TEXT DEFAULT '[]',
  notion_url TEXT,
  last_edited_time TEXT,
  last_synced_at TEXT NOT NULL,
  archived INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_index(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge_index(title);

ALTER TABLE tasks ADD COLUMN knowledge_page_ids_json TEXT DEFAULT '[]';
