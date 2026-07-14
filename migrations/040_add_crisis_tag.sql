-- Crisis tag ("prio"): a user-configurable label (settings.crisis_label,
-- default 'prio') that puts a task on the most aggressive nag path in the
-- app. See wiki/Crisis-Tag-And-Impact-Ranking.md for the full spec.
--
-- crisis_since        ISO timestamp stamped when the crisis label lands on
--                     the task (cleared when it's removed). Drives the
--                     Pushover Emergency escalation (>24h in crisis) and the
--                     "Still a crisis?" staleness check-in
--                     (settings.crisis_stale_days). Stamped server-side in
--                     upsertTask so every write path is covered.
-- crisis_triage_done  Set once the AI triage checklist has been generated
--                     for this crisis (useCrisisTriage hook). Reset when the
--                     crisis label is removed so a re-declared crisis gets a
--                     fresh triage pass.
ALTER TABLE tasks ADD COLUMN crisis_since TEXT;
ALTER TABLE tasks ADD COLUMN crisis_triage_done INTEGER DEFAULT 0;
