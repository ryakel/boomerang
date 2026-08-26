-- Calendar event rules (2026-08-26).
--
-- The pull sync turns a calendar event into a task OF ITSELF: a flight event
-- becomes a task called "Ryan Kelch in N5274S with Marty Kemp". What it could
-- never express is work the event IMPLIES but does not contain — the flight
-- means the budget spreadsheet needs updating, and that task is nowhere on the
-- calendar.
--
-- A rule is deterministic conditions plus a task template. Deterministic on
-- purpose and permanently: matching runs on every poll, so an AI match would
-- cost tokens per event forever, and "why did this fire?" would stop having an
-- answer you can read. AI belongs at AUTHORING time — it writes rules, it
-- never evaluates them.
--
-- gcal_rule_fires is the fire-once record, and it is on the SERVER for the
-- reason migration 053 spells out at length: the guard it replaces in spirit
-- (boom_notion_page_cache) lived in localStorage, which iOS evicts on a PWA,
-- and an evicted "have we already processed this?" flag makes every remote
-- item look brand new. Here that would mean re-firing every rule against every
-- event in the window, every time the eviction happened.
--
-- Two properties of the ledger that are easy to get backwards:
--
--   * It keys on the event INSTANCE id, not recurringEventId. The pull sync
--     collapses a recurring series to its first instance because you only want
--     one task for one meeting; rules want the opposite — a weekly flight is a
--     weekly budget update.
--
--   * task_id NULL means BASELINED: the rule matched this event at the moment
--     the rule was saved, and deliberately did not create anything. Saving a
--     rule must never backfill, or a slightly-too-broad rule empties a month of
--     calendar into Today on its first poll. Applying to those events is a
--     separate, explicit action, and it fills in task_id.
CREATE TABLE IF NOT EXISTS gcal_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- NULL = whichever calendar the pull sync is pointed at (gcal_calendar_id).
  calendar_id TEXT,
  -- [{ field, op, value }], ANDed. Never empty: a rule with no conditions
  -- matches every event on the calendar, which is a foot-gun with no use case.
  conditions_json TEXT NOT NULL DEFAULT '[]',
  -- { title, notes, due_offset_days, tags, size, high_priority, nag_allowed }
  template_json TEXT NOT NULL DEFAULT '{}',
  -- Stop the pull sync ALSO importing the triggering event as its own task,
  -- so a flight produces the budget task and not both.
  suppress_event_import INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_fired_at TEXT
);

CREATE TABLE IF NOT EXISTS gcal_rule_fires (
  rule_id TEXT NOT NULL,
  -- The event INSTANCE id. See above.
  event_id TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  -- NULL = baselined at rule-save time, no task created.
  task_id TEXT,
  -- What it was, so a human reading the table can tell what fired.
  event_title TEXT,
  PRIMARY KEY (rule_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_gcal_rule_fires_rule ON gcal_rule_fires(rule_id);
