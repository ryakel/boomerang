-- Per-loop "skipped/acknowledged" days for the loop reconcile review surface.
--
-- The Loops detail page surfaces days that need attention: completions a loop
-- never recorded, and cycles that were due but missed. Each day can be either
-- "Marked done" (stamps completed_history, crediting the cycle) or "Skipped"
-- ("I never did this, move on" — acknowledged without crediting). Skipped days
-- land here so they stop showing up as needing attention, while staying
-- honestly uncaught in the trail (a skip is not a completion). JSON array of
-- 'YYYY-MM-DD' local-day strings. NULL/[] = nothing skipped.
ALTER TABLE routines ADD COLUMN skipped_days_json TEXT;
