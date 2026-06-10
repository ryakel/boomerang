// Wallaby heatmap helpers — local-time day bucketing + per-habit color cycling.
// Shared by ContributionHeatmap and HabitsView so the grid math lives in one
// place. All bucketing is LOCAL time (not UTC) so "today" lines up with what
// the user sees on their device.

// Per-habit accent cycle. Mirrors the --wb-cat-* tokens in palette.css (dark
// values) — keep the two lists in sync when tuning the palette.
export const WALLABY_COLORS = ['#4F8DF5', '#8C7CF0', '#41C083', '#F0973E', '#EA6C9D']

// One color-identity rule for every Wallaby surface (Home, Habits, Profile):
// a routine's color comes from its index in the FULL routines list, so the
// same habit renders the same color everywhere — and pausing/unpausing a
// different routine doesn't shuffle anyone else's color.
export function routineColors(routines) {
  const m = {}
  for (let i = 0; i < (routines?.length || 0); i++) {
    m[routines[i].id] = WALLABY_COLORS[i % WALLABY_COLORS.length]
  }
  return m
}

// Date-only strings ('YYYY-MM-DD') must be treated as LOCAL dates. Naive
// `new Date('YYYY-MM-DD')` parses as UTC midnight, which lands on the
// PREVIOUS local day anywhere west of UTC — that bug made a task due today
// read as overdue. Anything else (Date, full ISO timestamp) parses normally.
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

export function parseLocalDate(d) {
  if (typeof d === 'string' && YMD_RE.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day)
  }
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? null : x
}

export function localYMD(d) {
  // A date-only string already IS a local day key.
  if (typeof d === 'string' && YMD_RE.test(d)) return d
  const x = parseLocalDate(d)
  if (!x) return null
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

// completed_history (array of ISO timestamps) → { 'YYYY-MM-DD': count }
export function historyByDay(history) {
  const m = {}
  for (const ts of (history || [])) {
    const k = localYMD(ts)
    if (k) m[k] = (m[k] || 0) + 1
  }
  return m
}

// Consecutive-day streak ending today (today optional — if today has no entry
// we still count a streak that ran up to yesterday, the conventional rule).
export function currentStreak(valueByDay) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  // If today is empty, start counting from yesterday so an unlogged "today"
  // doesn't read as a broken streak mid-day.
  if (!valueByDay[localYMD(d)]) d.setDate(d.getDate() - 1)
  let streak = 0
  for (;;) {
    if (valueByDay[localYMD(d)]) { streak++; d.setDate(d.getDate() - 1) }
    else break
  }
  return streak
}

// Longest run of consecutive logged days anywhere in the history.
export function longestStreak(valueByDay) {
  const days = Object.keys(valueByDay).filter(k => valueByDay[k]).sort()
  if (days.length === 0) return 0
  let best = 1, run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = parseLocalDate(days[i - 1]); prev.setDate(prev.getDate() + 1)
    if (localYMD(prev) === days[i]) { run++; best = Math.max(best, run) }
    else run = 1
  }
  return best
}

// Monday-anchored start of the week containing `ref` (+ weekOffset weeks).
export function weekStart(ref, weekOffset = 0) {
  const d = new Date(ref)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  d.setDate(d.getDate() - dow + weekOffset * 7)
  return d
}

export function addDays(d, n) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtMonthDay(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
