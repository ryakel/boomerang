-- Escalation Ladder: tracks repeated attempts to reach an unresponsive
-- person/organization, and prompts to change TACTIC once a rung's attempts
-- are exhausted (rather than just re-nagging the same dead approach).
-- See wiki/Escalation-Ladder.md for the full spec.
--
-- escalation_rungs_json       Ordered array of {id, label, suggestion,
--                             script?, attempts_before_ready, nudge_every_days}.
--                             NULL/[] = feature off for this task.
-- escalation_current_rung     Index into escalation_rungs_json. NULL = no
--                             active ladder (never started, or resolved via
--                             "Got a response" — the rungs stay as a record,
--                             this is what flips the ladder back to inactive).
-- escalation_attempt_log_json Append-only array of {id, at, rung_index,
--                             points: 1} — every logged attempt across every
--                             rung, never trimmed (audit trail + points source).
-- escalation_awaiting_advance Set when the current rung's attempts_before_ready
--                             is met and the app is OFFERING to move on but
--                             hasn't yet (prompted, not automatic — see spec).
-- escalation_stuck            Set when the LAST rung's threshold is met and
--                             there's nowhere scripted left to go (surfaces
--                             the "Brainstorm next moves" action).
ALTER TABLE tasks ADD COLUMN escalation_rungs_json TEXT;
ALTER TABLE tasks ADD COLUMN escalation_current_rung INTEGER DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN escalation_attempt_log_json TEXT;
ALTER TABLE tasks ADD COLUMN escalation_awaiting_advance INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN escalation_stuck INTEGER DEFAULT 0;
