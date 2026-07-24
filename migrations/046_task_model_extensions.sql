-- Task model extensions (2026-07-18) — the schema step of the
-- implementation-intentions / shrink-it / punishment-free re-entry /
-- location-reminders / watch-app sequence. All columns nullable/defaulted;
-- existing rows and clients unaffected.
--
-- intention_when / intention_where  Implementation intention triggers.
--     Free text ON PURPOSE — the value is the commitment phrasing
--     ("after I pour coffee", "at my desk"), not machine parsing.
-- first_step        Shrink-it: the smallest concrete first action (<=140
--                   chars, enforced at the API layer).
-- location_json     {lat, lng, radius_m, label, trigger: "arrive"|"leave"}
--                   for point-of-performance reminders. Stored now; geofence
--                   delivery is a later feature.
-- committed_on      'YYYY-MM-DD' local day the task was committed as one of
--                   today's three (pick-three). NULL = not committed.
--                   Exposed as derived state 'committed' when == today.
-- boomerang_count   Times the task has come back around (committed but the
--                   day ended without completion). Data, not a shame counter
--                   — never surfaced as a streak-breaking metric.
-- last_boomeranged_at  When it last came back.
-- released_at       "Let it go" timestamp (outcome: released) — a
--                   first-class action, not a delete. Pairs with
--                   status='cancelled'; derived state 'archived'.
--
-- NOTE: there is deliberately NO `state` column. State is DERIVED from the
-- existing `status` machinery + these fields (see server/taskModel.js) so
-- the app keeps exactly one source of truth. The spec's snooze_until maps
-- onto the existing snoozed_until/snooze_indefinite machinery.
ALTER TABLE tasks ADD COLUMN intention_when TEXT;
ALTER TABLE tasks ADD COLUMN intention_where TEXT;
ALTER TABLE tasks ADD COLUMN first_step TEXT;
ALTER TABLE tasks ADD COLUMN location_json TEXT;
ALTER TABLE tasks ADD COLUMN committed_on TEXT;
ALTER TABLE tasks ADD COLUMN boomerang_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN last_boomeranged_at TEXT;
ALTER TABLE tasks ADD COLUMN released_at TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_committed_on ON tasks(committed_on);
