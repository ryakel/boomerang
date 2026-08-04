// streakWalk.js — the streak's backward walk, in ONE place. Pure: no dates
// library, no store, no db; callers supply predicates and the clock.
//
// It lives in server/ despite being shared because the Dockerfile copies
// `server/` into the runtime image and does NOT copy `src/` — a shared module
// placed in src/ resolves in dev and in the Vite bundle, then crashes the
// container on boot. Same reason src/api.js already imports server/aiModels.js.
//
// WHY IT'S EXTRACTED. The rule lived twice — `computeStreak()` in src/store.js
// for what the user sees, and the analytics walk in server/db.js — as two
// hand-written implementations of "the same" logic. That is precisely the shape
// of the bug that lost a 100-day streak on 2026-08-03: the away window moved
// house, one consumer was updated, the other was left pointing at a dead flag,
// and nothing could tell you they disagreed. Two copies of a rule cannot be
// tested into agreement; one copy can just be tested.
//
// THE RULE, in one sentence: walk back from today and count every KEPT day,
// stepping over PAUSED days without counting them, stopping at the first day
// that is neither.
//
//   kept   — you completed something, or it was a free day, or nothing was
//            active to fail at. Counts toward the streak.
//   paused — an away day. Neither breaks the streak nor builds it: a week
//            abroad leaves the number exactly where it was. A day that is both
//            away AND kept counts, because being away doesn't erase real work.

/**
 * @param todayMs  ms since epoch for "now"
 * @param isKept   (Date) => boolean
 * @param isPaused (Date) => boolean
 * @param floorMs  ms; stop walking past this (the streak_anchor floor). null = no floor
 * @param guard    max iterations; ~10 years of defence-in-depth
 */
export function walkStreak({ todayMs, isKept, isPaused, floorMs = null, guard = 3650 }) {
  const d = new Date(todayMs)
  let left = guard

  // Step over any away days between now and the last real activity. Without
  // this, coming home to an unfinished today would read the trip's final day
  // as the break — the streak would survive the whole week and then die on the
  // doorstep.
  while (!isKept(d) && isPaused(d) && left-- > 0) d.setDate(d.getDate() - 1)

  // The existing one-day grace: nothing done yet today doesn't end a streak,
  // it just means the day isn't over. Look at yesterday before giving up —
  // and step over away days again, for the same reason as above.
  if (!isKept(d)) {
    d.setDate(d.getDate() - 1)
    while (!isKept(d) && isPaused(d) && left-- > 0) d.setDate(d.getDate() - 1)
    if (!isKept(d)) return 0
  }

  let streak = 0
  while (left-- > 0) {
    if (floorMs != null && d.getTime() < floorMs) break
    if (!isKept(d)) {
      if (!isPaused(d)) break
      d.setDate(d.getDate() - 1)
      continue
    }
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

// 'YYYY-MM-DD' from a Date, in LOCAL time — the shape away_days/free_days use.
// Local, not UTC: the window is a statement about days where the user is.
export function dayKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
