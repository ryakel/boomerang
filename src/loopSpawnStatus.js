// loopSpawnStatus.js — which task statuses release a loop's cycle, and which
// loops a task-side deferral may move. Pure: no React, no store, no clock.
// Tested in scripts/loopSpawnStatus.test.mjs.
//
// THE BUG THIS CLOSES (2026-09-12, "I'm not seeing some loop tasks show up on
// the today page")
//
// `spawnDueTasks` had two guards. The auto_roll path used a proper terminal
// set; the legacy path blocked on anything that wasn't literally `done`:
//
//     existingTasks.some(t => t.routine_id === routine.id && t.status !== 'done')
//
// `backlog`, `cancelled` and `project` are first-class, user-reachable statuses
// — the Backlog tab, the row swipe, the status menu — and NOTHING ever clears
// `routine_id` when a task moves into one. So a routine task sent to Backlog
// was at once invisible on Today (which renders only not_started / doing /
// waiting / in_progress) and a PERMANENT block on its loop: `!== 'done'` stays
// true forever. The loop card kept rendering "due, not done" — its dueToday
// consults only the cadence engine — while no task could ever be created for it
// again. One swipe, and a weekly loop was silently dead.
//
// Every other consumer in the app already treated these three as terminal
// (store.js, AppV2, kept/TodayView.jsx, kept/cycles.js); the legacy spawn guard
// was the last one that didn't.

/**
 * Statuses that END a routine instance's claim on its cycle: it stops blocking
 * the next spawn, and auto_roll won't carry it forward.
 */
export const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'backlog', 'project'])

/**
 * The subset that closes a cycle WITHOUT doing it — a deferral, not evidence of
 * work.
 *
 * These need the schedule moved as well as the guard released.
 * `computeNextDueDate` returns the slot after the LAST COMPLETION and never
 * advances with the calendar, so an uncompleted cycle stays pinned at the same
 * stale due date. Releasing the guard alone would therefore respawn an
 * identical task on the very next pass: backlog it, it comes straight back.
 * The lever that says "the schedule moved, nothing was done" is `resume_at`
 * (src/resumeFloor.js) — never a completed_history stamp, which would credit
 * the cycle, extend the rally and fill in the trail for work that didn't happen.
 */
export const DEFERRED_STATUSES = new Set(['cancelled', 'backlog', 'project'])

/** Does this task still hold its loop's current cycle open? */
export function blocksSpawn(task, routineId) {
  if (!task || task.routine_id !== routineId) return false
  return !TERMINAL_STATUSES.has(task.status)
}

/** Is any of `tasks` still holding this loop's cycle open? */
export function hasLiveInstance(tasks, routineId) {
  return (tasks || []).some(t => blocksSpawn(t, routineId))
}

/** Is `status` a deferral — cycle closed, nothing done? */
export function isDeferral(status) {
  return DEFERRED_STATUSES.has(status)
}

/**
 * May a task-side deferral move this loop's `resume_at`?
 *
 * No for habit loops (no cadence to move) and no for stacks: a stack's spawn
 * guard is already keyed per (routine_id, due_date), so backlogging ONE member
 * must not push the whole stack's next cycle out from under its siblings.
 */
export function acceptsDeferral(routine) {
  if (!routine) return false
  if (routine.spawn_mode === 'habit') return false
  if (Array.isArray(routine.members) && routine.members.length > 0) return false
  return true
}

/**
 * Which date a task-side deferral steps its cycle off: the loop's own next due
 * slot, or today when that slot is already in the past.
 *
 * `computeNextDueDate` returns the slot after the LAST COMPLETION and never
 * advances with the calendar, so a loop that is weeks behind carries a due date
 * weeks in the past. Stepping ONE interval off that (what `pushOutOneCycle`
 * does for the explicit Skip / Push-it-out buttons) frequently lands in the
 * past too — and `applyResumeFloor` ignores a past floor by design, so the
 * deferral would be a no-op and the loop would respawn the task the instant it
 * was backlogged. A button the user presses can compound its way out of that;
 * an automatic defer would just churn.
 *
 * Stepping from whichever is LATER keeps "not this time" meaning at least one
 * more cycle of quiet, however far behind the loop had fallen.
 */
export function deferFloorBase(nextDue, today) {
  if (!nextDue) return today
  return nextDue.getTime() > today.getTime() ? nextDue : today
}
