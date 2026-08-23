// resumeFloor.js — the "push this loop out" date rule. Pure: no imports, no
// clock of its own. Tested in scripts/resumeAt.test.mjs.
//
// WHY A FLOOR AND NOT AN ANCHOR (migration 054)
//
// A loop had exactly two levers, and neither could say "the schedule moved":
//
//   completed_history stamp  "I did it"          credits AND moves the schedule
//   skipped_days entry       "stop asking"       no credit, no schedule change
//
// So "Skip cycle" — labelled *advance the schedule without spawning a task* —
// expressed itself by appending a completion stamp. That is evidence of work:
// it credited the cycle, extended the rally, grew the "Nx completed" total and
// filled in the trail. Every "not this time" was recorded as "I did it".
//
// `resume_at` is the missing third lever: a FLOOR on the next due date. It is
// deliberately not a rewritten anchor — the cadence grid stays put (matching
// cycleWindows' fixed-grid philosophy), so pushing a loop out delays the next
// occurrence without silently re-phasing every cycle after it.

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Parse a local 'YYYY-MM-DD' to a local midnight Date, or null. */
export function parseYMD(raw) {
  if (!YMD.test(String(raw || ''))) return null
  const [y, m, d] = String(raw).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  // Rejects impossible dates that the regex lets through (2026-02-31).
  return Number.isFinite(dt.getTime()) && dt.getMonth() === m - 1 ? dt : null
}

/**
 * Raise `next` to `resumeAt` when the floor is later. A floor in the PAST is
 * ignored — it must never drag a loop backwards to a stale date, which is what
 * would happen to every loop still carrying last month's push.
 */
export function applyResumeFloor(next, resumeAt) {
  if (!next) return next
  const floor = parseYMD(resumeAt)
  if (!floor) return next
  return floor.getTime() > next.getTime() ? floor : next
}
