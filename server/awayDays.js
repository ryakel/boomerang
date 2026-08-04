// awayDays.js — which local days an away window has covered so far. Pure: no
// db, no network, the clock is passed in. Tested in scripts/awayDays.test.mjs.
//
// WHY THIS EXISTS (2026-08-03 incident: "you completely fucked my 100 day
// streak with your shit show of an away mode").
//
// The streak is computed by walking backwards day by day and stopping at the
// first day with no completion that wasn't no-fault. A week away is a week of
// exactly that, so the away window has to make those days no-fault or the trip
// itself ends the streak — and `vacationWindow.js`'s own header says the two
// things the window exists to prevent are resumed nagging and a broken streak.
//
// It didn't. `computeStreak()` guards on `settings.vacation_mode`, the legacy
// settings-blob boolean the away redesign deliberately ABANDONED (the blob is
// last-writer-wins and any stale client pushes `false`). When the window moved
// to its own `app_data` carve-out, the notification gate moved with it and the
// streak guard was left pointing at a flag nothing writes any more. Away
// suppressed notifications and silently protected nothing.
//
// So the days are STAMPED, not derived. CLAUDE.md's rule: never derive a
// user-visible earned value from live state — persist provenance at
// observation time. A window that gets switched off when the user gets home
// must not retroactively un-protect the days it covered, and a derived-only
// answer would do exactly that.

const YMD = /^\d{4}-\d{2}-\d{2}$/

// A trip is not five years long. The cap stops a window with a garbage or
// long-forgotten `started_at` from stamping tens of thousands of days into the
// settings blob — this list is synced on every write.
export const MAX_AWAY_DAYS = 400

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const x = new Date(y, m - 1, d + n)
  const p = (v) => String(v).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`
}

/**
 * Every local day the window has covered up to and including `todayYMD`.
 *
 * Deliberately INCLUSIVE of today: a day you are away is protected the moment
 * it starts, not retroactively the following morning. Waiting would leave a
 * gap on any day the app is opened before midnight — which is every day.
 *
 * Returns [] for a window that is inactive, malformed, or hasn't started.
 * An `ends_at` in the past still yields the days it covered: the window being
 * over does not un-happen the trip.
 */
export function awayDaysElapsed(window, todayYMD) {
  const w = window || {}
  if (!w.active) return []
  if (!YMD.test(String(todayYMD || ''))) return []
  const start = YMD.test(String(w.started_at || '')) ? String(w.started_at) : null
  // No start means "from whenever I switched it on", and nothing recorded when
  // that was — so it can only speak for today. Claiming history it was never
  // told about is how a streak gets silently inflated.
  if (!start) return [todayYMD]
  if (start > todayYMD) return []
  const end = YMD.test(String(w.ends_at || '')) ? String(w.ends_at) : null
  const last = end && end < todayYMD ? end : todayYMD

  const out = []
  let cur = start
  while (cur <= last && out.length < MAX_AWAY_DAYS) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

/**
 * Union `days` into an existing sorted list, returning null when there is
 * nothing new — so callers can skip the write entirely rather than churning
 * the settings blob (and its sync) once a minute for no change.
 */
export function mergeAwayDays(existing, days) {
  const prev = Array.isArray(existing) ? existing : []
  if (days.length === 0) return null
  const set = new Set(prev)
  let added = 0
  for (const d of days) if (!set.has(d)) { set.add(d); added++ }
  if (added === 0) return null
  return [...set].sort()
}
