// Wallaby heatmap helpers — local-time day bucketing + per-habit color cycling.
// Shared by ContributionHeatmap and HabitsView so the grid math lives in one
// place. All bucketing is LOCAL time (not UTC) so "today" lines up with what
// the user sees on their device.

export const WALLABY_COLORS = ['#4F8DF5', '#8C7CF0', '#41C083', '#F0973E', '#EA6C9D']

// Deterministic per-habit color from an id. Stable across reloads so a routine
// keeps the same color (matches the loggd per-habit color identity).
export function habitColor(id) {
  const s = String(id ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return WALLABY_COLORS[h % WALLABY_COLORS.length]
}

export function localYMD(d) {
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return null
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
    const prev = new Date(days[i - 1]); prev.setDate(prev.getDate() + 1)
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
