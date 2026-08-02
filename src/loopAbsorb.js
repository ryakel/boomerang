// loopAbsorb.js — what happens to a task's REMINDER when that task becomes a
// LOOP. Pure: no store, no clock of its own, no React.
//
// The problem, in the user's words: "If we convert a reminder to a loop,
// compare the start date of the loop with the reminder date… let the user know
// with a little just-in-time nudge."
//
// A task can carry a one-off reminder ("ring me Tuesday 7:30pm"). Converting it
// to a loop creates a recurring schedule that may ALSO ring. Left alone that is
// two bells for one intention — the exact failure the whole reminder design
// exists to avoid — or, just as bad, a silently discarded reminder the user
// still expects to fire.
//
// The rule: the loop ABSORBS the reminder when the loop's first cycle already
// covers that moment. Otherwise the reminder stays standalone, because it is
// asking for something the loop won't do yet.
//
//   |----- first cycle window -----|----- second -----|
//   ^firstSpawn                    ^windowEnd
//        ↑ reminder here → ABSORB (the loop's own first ring is that moment)
//   ↑ reminder before firstSpawn → KEEP (the loop hasn't started yet)
//                                     ↑ reminder here → KEEP (a later cycle
//                                       would ring at the loop's time, not
//                                       the one the user picked)
//
// WHY THE FIRST SPAWN IS A PARAMETER: `getNextDueDate()` in store.js owns the
// cadence grid — weekday snapping, day-of-month rules, ordinal weeks, the
// series-start walk. Reimplementing any of that here to be "self-contained"
// would create a second grid that drifts from the first, which is a worse bug
// than the one this module fixes. The caller passes the answer; this module
// owns only the window arithmetic and the decision.

const MONTH_UNITS = new Set(['monthly', 'quarterly', 'annually'])

// The length of ONE cycle, applied to a Date. Month-scale cadences step by
// calendar months (not 30 days) so a monthly loop created on the 31st behaves
// the way the rest of the app's month math already does.
function addOneCycle(date, { cadence, customDays, customUnit }) {
  const d = new Date(date)
  const n = Math.max(1, Number(customDays) || 1)
  if (cadence === 'daily') { d.setDate(d.getDate() + 1); return d }
  if (cadence === 'weekly') { d.setDate(d.getDate() + 7); return d }
  if (cadence === 'monthly') { d.setMonth(d.getMonth() + 1); return d }
  if (cadence === 'quarterly') { d.setMonth(d.getMonth() + 3); return d }
  if (cadence === 'annually') { d.setFullYear(d.getFullYear() + 1); return d }
  if (cadence === 'custom') {
    if (customUnit === 'months') d.setMonth(d.getMonth() + n)
    else d.setDate(d.getDate() + n)
    return d
  }
  // Unknown cadence: one day is the least surprising floor, and it keeps the
  // window from being empty (which would silently absorb nothing, ever).
  d.setDate(d.getDate() + 1)
  return d
}

const two = (n) => String(n).padStart(2, '0')

// 'HH:MM' local — the shape routines.trigger_time already stores.
export function clockOf(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

function niceTime(date) {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function niceDay(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * planLoopAbsorption({ remindAt, firstSpawn, cadence, customDays, customUnit, now })
 *
 *   remindAt   ISO string or Date — the task's existing one-off reminder (may be null)
 *   firstSpawn Date/ISO — when the loop first spawns (from getNextDueDate)
 *   now        ms — injected clock
 *
 * → { absorb, triggerTime, clearTaskRemind, windowEnd, nudge }
 *
 * `nudge` is the just-in-time line shown at the decision point — before the
 * conversion, where the user can still change their mind. It is never a
 * notification: the whole point is that it costs nothing and interrupts
 * nobody.
 */
export function planLoopAbsorption({
  remindAt = null,
  firstSpawn = null,
  cadence = 'daily',
  customDays = null,
  customUnit = 'days',
  now = Date.now(),
} = {}) {
  const none = { absorb: false, triggerTime: null, clearTaskRemind: false, windowEnd: null, nudge: '' }

  if (!remindAt) return none
  const remind = remindAt instanceof Date ? remindAt : new Date(remindAt)
  if (Number.isNaN(remind.getTime())) return none

  const spawn = firstSpawn instanceof Date ? firstSpawn : (firstSpawn ? new Date(firstSpawn) : null)
  if (!spawn || Number.isNaN(spawn.getTime())) {
    // No grid answer available. Keeping the reminder is the safe direction:
    // the user loses nothing, and a duplicate bell is recoverable while a
    // silently deleted reminder is not.
    return { ...none, nudge: 'Your reminder stays as it is; the loop rings on its own schedule.' }
  }

  const triggerTime = clockOf(remind)

  // A reminder whose moment has already gone can't be preserved — there is
  // nothing left to fire. Its TIME OF DAY is still the user's stated intent,
  // so the loop inherits that and the dead one-off is cleared.
  if (remind.getTime() <= now) {
    return {
      absorb: true,
      triggerTime,
      clearTaskRemind: true,
      windowEnd: null,
      nudge: `That reminder time has already passed — the loop will take it over and ring at ${niceTime(remind)} each time instead.`,
    }
  }

  // The window starts at the START of the first spawn's day: the grid returns a
  // day, and a reminder at 7:30am on that day is inside the cycle even though
  // getNextDueDate's Date lands at midnight or later.
  const windowStart = new Date(spawn)
  windowStart.setHours(0, 0, 0, 0)
  const windowEnd = addOneCycle(windowStart, { cadence, customDays, customUnit })

  const inFirstCycle = remind.getTime() >= windowStart.getTime() && remind.getTime() < windowEnd.getTime()

  if (inFirstCycle) {
    // The pending reminder is KEPT even though the loop absorbs the rhythm.
    // The task being converted stays active and carries routine_id, and the
    // spawn pass skips a routine that already has a non-done instance — so the
    // loop will NOT mint a first occurrence to carry the alarm. Clearing here
    // would silently lose the very ring the user is standing in front of. One
    // bell now from the task, one per cycle after that from the loop.
    return {
      absorb: true,
      triggerTime,
      clearTaskRemind: false,
      windowEnd: windowEnd.toISOString(),
      nudge: `This one still rings at ${niceTime(remind)} on ${niceDay(remind)}, and the loop takes that time from here on — ${niceTime(remind)} every cycle.`,
    }
  }

  const before = remind.getTime() < windowStart.getTime()
  return {
    absorb: false,
    triggerTime: null,
    clearTaskRemind: false,
    windowEnd: windowEnd.toISOString(),
    nudge: before
      ? `Your ${niceDay(remind)} reminder is before the loop's first cycle (${niceDay(windowStart)}), so it stays as a one-off. You'll get that one, then the loop takes over.`
      : `Your reminder is on ${niceDay(remind)}, past the loop's first cycle, so it stays as a one-off alongside the loop.`,
  }
}
