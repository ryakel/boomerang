// vacationRepair.js — planning the bulk due-date repair after an away window.
// Pure: no db, no network, no clock. Tested in scripts/vacationRepair.test.mjs.
//
// The owner's actual pain (2026-07-29): "if I travel for a couple of days
// before I've remembered to set it, I've created an obligation where I have to
// go back and fix a bunch of dates." Suppression (shipped in v2.47.0) stops the
// nagging; THIS is the half that removes the date surgery — one action instead
// of hand-editing every task that came due mid-trip.
//
// Shaped like rolloverPlan: a pure plan of {id, from, to} computed here, applied
// by the server through the normal write path, so the chaos cases (run it
// twice, run it after a manual edit) are unit-testable.
//
// The plan MOVES FORWARD ONLY. A task due inside the window but on or after the
// target date is left alone — repair must never pull a date earlier, and a
// window whose stored dates reach past today (turned off early, say) must not
// touch tasks that haven't actually gone overdue.
import { windowDays } from './vacationWindow.js'
import { isActiveStatus } from './taskModel.js'

const YMD = /^\d{4}-\d{2}-\d{2}$/

/**
 * @param tasks    task rows (any shape; non-tasks are skipped)
 * @param window   the stored away window (normalized or raw)
 * @param opts.todayYMD   today, local — required; also bounds open-ended windows
 * @param opts.targetYMD  where qualifying dues land; defaults to today
 * @param opts.isExcluded optional predicate; a true return skips the task.
 *                        The endpoint passes the crisis check here — crisis
 *                        tasks were never suppressed, so they were never
 *                        invisible, and repair only covers what suppression hid.
 * @returns [{ id, from, to }]
 */
export function repairPlan(tasks, window, { todayYMD, targetYMD = null, isExcluded = null } = {}) {
  if (!YMD.test(String(todayYMD || ''))) return []
  const target = targetYMD == null ? todayYMD : String(targetYMD)
  if (!YMD.test(target)) return []

  const days = new Set(windowDays(window, { todayYMD }))
  if (!days.size) return []

  const plan = []
  for (const t of tasks || []) {
    if (!t || !t.id) continue
    if (!isActiveStatus(t.status)) continue
    if (!t.due_date) continue
    // due_date is date-only by convention; slice defends against a stray
    // timestamp without rejecting the task it's on.
    const due = String(t.due_date).slice(0, 10)
    if (!YMD.test(due)) continue
    if (!days.has(due)) continue
    // Forward only, strictly: due == target is a no-op, due > target would be
    // a pull-in. Also naturally makes the plan idempotent — a moved task's new
    // date is the target, which this line refuses to move again.
    if (due >= target) continue
    if (isExcluded && isExcluded(t)) continue
    plan.push({ id: t.id, from: due, to: target })
  }
  return plan
}
