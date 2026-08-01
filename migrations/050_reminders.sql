-- Apple Reminders two-way sync (2026-08-01).
--
-- Two features in one link. Apple fires the ALARM — EventKit reminders carry
-- real alarms, so the Lock Screen, CarPlay, HomePod and Watch all work with no
-- new Boomerang send path, which keeps the Great Alert Deletion's surviving
-- list intact. And the same list is a voice-capture INBOX: "Hey Siri, remind me
-- to call the roofer" already works perfectly and lands in Reminders, so
-- pulling that list in gets Siri capture without winning the App Intents
-- phrase-matching fight.
--
-- Boomerang stays the system of record. Reminders is an alarm surface and a
-- capture inbox, not a second source of truth.

-- The time an alarm should fire. Distinct from due_date, which is a DATE with
-- no time component and means "this is due on this day" rather than "interrupt
-- me at this moment". A task can have either, both, or neither.
ALTER TABLE tasks ADD COLUMN remind_at TEXT;

-- EKReminder calendarItemIdentifier. Same shape of link as gcal_event_id and
-- trello_card_id. NULL = this task has never been pushed to Reminders.
ALTER TABLE tasks ADD COLUMN reminders_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_remind_at ON tasks(remind_at);
CREATE INDEX IF NOT EXISTS idx_tasks_reminders_id ON tasks(reminders_id);

-- The 3-way baseline: what Boomerang and Reminders last AGREED on, in its own
-- table rather than six more columns on a tasks table that already carries
-- seventy. Same reasoning as list_items.shadow_* (migration 047): a two-way
-- diff between "what I have" and "what the phone has" cannot tell "I edited
-- this in Boomerang" from "I edited it in Reminders", so it degrades to
-- last-writer-wins and silently eats one of them. Comparing each side against
-- this baseline separately is what makes the difference legible.
--
-- A row here means the two sides have agreed at least once. NO row for a task
-- with a reminders_id means the link exists but the baseline was lost, which
-- the merge treats as "cannot prove who moved" rather than guessing.
CREATE TABLE IF NOT EXISTS reminder_shadows (
  task_id TEXT PRIMARY KEY,
  reminders_id TEXT NOT NULL,
  title TEXT,
  notes TEXT,
  remind_at TEXT,
  completed INTEGER DEFAULT 0,
  synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminder_shadows_rid ON reminder_shadows(reminders_id);
