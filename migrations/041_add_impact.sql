-- Impact-based prioritization: a third AI-inferred dimension alongside size
-- and energy. See wiki/Crisis-Tag-And-Impact-Ranking.md for the full spec.
--
-- impact           1-3. 3 = affects people you're responsible to (spouse,
--                  household) or carries real money/health/legal consequences
--                  or unblocks other things; 2 = meaningful forward motion on
--                  your own commitments; 1 = self-only, low consequence.
--                  NULL = not yet inferred (scores/displays as 2 until then —
--                  backfill is deliberately lazy, no re-inference storm).
-- impact_inferred  Same semantics as size_inferred: set after AI inference OR
--                  a manual pick, so the background sizer doesn't overwrite a
--                  hand-set value.
--
-- Routines carry impact too — it propagates to spawned tasks at every spawn
-- path, same as energy_type/assignee.
ALTER TABLE tasks ADD COLUMN impact INTEGER DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN impact_inferred INTEGER DEFAULT 0;
ALTER TABLE routines ADD COLUMN impact INTEGER DEFAULT NULL;
