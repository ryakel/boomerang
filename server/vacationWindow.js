// vacationWindow.js — normalizing and evaluating the away window. Pure: no db,
// no network, and the clock is always passed in. Tested in
// scripts/vacationWindow.test.mjs.
//
// Why this is its own module, and why the window does NOT live in the settings
// blob (2026-07-29):
//
// The bulk settings sync is whole-blob last-writer-wins. `vacation_mode: false`
// has been in `src/store.js` defaults since the streak work, so ANY client with
// unhydrated localStorage pushes an explicit `false` and switches the window off
// within seconds — the exact `pushover_open_native` failure, twice shipped.
// `preserveAbsentSettings()` cannot help: it protects a key a stale client
// OMITS, and this one is always present.
//
// A window that silently deactivates while you are away resumes the nagging and
// breaks the streak — precisely the two things it exists to prevent, failing
// invisibly. So it gets an `app_data` carve-out (`vacation_window`) written only
// by its own endpoints, and this module owns the shape.

// A window is stored as { active, started_at, ends_at }. `ends_at` may be null
// (open-ended: "I'll tell you when I'm back"). Dates are YYYY-MM-DD local days,
// not instants — "I'm away Tuesday to Friday" is a statement about days, and
// storing an ISO timestamp would make the boundaries depend on what time of day
// you happened to open the app.
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function normalizeWindow(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const started = YMD.test(String(r.started_at || '')) ? String(r.started_at) : null
  const ends = YMD.test(String(r.ends_at || '')) ? String(r.ends_at) : null
  // An end before the start is nonsense; drop the end rather than invert the
  // window, because inverting would silently suppress a range nobody asked for.
  const safeEnds = started && ends && ends < started ? null : ends
  return {
    active: !!r.active,
    started_at: started,
    ends_at: safeEnds,
    // Free-text reason, purely for the UI ("Wisconsin"). Never interpreted.
    note: typeof r.note === 'string' ? r.note.slice(0, 120) : '',
  }
}

/**
 * Is the window suppressing right now?
 *
 * @param raw     the stored window
 * @param todayYMD today as YYYY-MM-DD *local* — passed in, never read from a clock
 */
export function isAway(raw, todayYMD) {
  const w = normalizeWindow(raw)
  if (!w.active) return false
  if (!YMD.test(String(todayYMD || ''))) return false
  // A window with no start is treated as active-from-now rather than
  // active-forever-backwards: an unset start must not retroactively claim
  // history it was never told about.
  if (w.started_at && todayYMD < w.started_at) return false
  if (w.ends_at && todayYMD > w.ends_at) return false
  return true
}

/**
 * Has a dated window run out? The UI uses this to offer "welcome back" rather
 * than leaving a stale window suppressing forever — the failure mode that makes
 * this feature dangerous is silence you cannot see, and a window nobody ever
 * closes is exactly that.
 *
 * Open-ended windows (`ends_at === null`) are never expired: they were opened
 * deliberately without an end and only a human closes them.
 */
export function isExpired(raw, todayYMD) {
  const w = normalizeWindow(raw)
  if (!w.active || !w.ends_at) return false
  if (!YMD.test(String(todayYMD || ''))) return false
  return todayYMD > w.ends_at
}

/**
 * The inclusive list of days a window covered, bounded so a typo like
 * `started_at: '0202-01-01'` can't ask for 700k days. Used by the (upcoming)
 * bulk repair to find tasks whose due date fell inside the absence, and by the
 * UI to say how long you were gone.
 */
export function windowDays(raw, { todayYMD = null, maxDays = 400 } = {}) {
  const w = normalizeWindow(raw)
  if (!w.started_at) return []
  const last = w.ends_at || (YMD.test(String(todayYMD || '')) ? todayYMD : null)
  if (!last || last < w.started_at) return []
  const out = []
  // String dates, UTC arithmetic: these are calendar labels, so constructing
  // them at UTC midnight keeps a DST boundary from dropping or repeating a day.
  const cur = new Date(`${w.started_at}T00:00:00Z`)
  const end = new Date(`${last}T00:00:00Z`)
  while (cur <= end && out.length < maxDays) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}
