// Lightweight natural-language date parser → 'YYYY-MM-DD' | null.
// Pure, dependency-free, local (no AI call needed for the common cases). Used by
// the shared DateField so any task due-date input accepts "tomorrow", "next
// tue", "in 3 days", "fri", "next week", "6/9", etc. Theme-agnostic.

const WEEKDAYS = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
}

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Returns a 'YYYY-MM-DD' string, or null if the text can't be understood.
export function parseNaturalDate(input, base = new Date()) {
  if (input == null) return null
  let s = String(input).trim().toLowerCase()
  if (!s) return null

  // Already an ISO date — pass through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  const today = new Date(base); today.setHours(0, 0, 0, 0)
  const add = n => { const d = new Date(today); d.setDate(d.getDate() + n); return ymd(d) }

  // Plain words.
  if (s === 'today' || s === 'tonight' || s === 'now') return ymd(today)
  if (s === 'tomorrow' || s === 'tmr' || s === 'tmrw') return add(1)
  if (s === 'yesterday') return add(-1)
  if (s === 'next week') return add(7)
  if (s === 'next month') { const d = new Date(today); d.setMonth(d.getMonth() + 1); return ymd(d) }

  // "in N days/weeks/months" (and "in a day/week/month").
  let m = s.match(/^in\s+(a|an|\d+)\s+(day|days|week|weeks|month|months)$/)
  if (m) {
    const n = (m[1] === 'a' || m[1] === 'an') ? 1 : parseInt(m[1], 10)
    if (m[2].startsWith('day')) return add(n)
    if (m[2].startsWith('week')) return add(n * 7)
    if (m[2].startsWith('month')) { const d = new Date(today); d.setMonth(d.getMonth() + n); return ymd(d) }
  }

  // "N days" shorthand.
  m = s.match(/^(\d+)\s*d(ays?)?$/)
  if (m) return add(parseInt(m[1], 10))

  // Weekday, optionally "next" / "this". "next fri" = the Friday in the next
  // week's occurrence; "fri"/"this fri" = the next upcoming Friday (today counts
  // only if it's later — for due dates we take the next future match, min 1 day
  // ahead so "fri" on a Friday means next Friday).
  m = s.match(/^(next|this|on)?\s*([a-z]+)$/)
  if (m && WEEKDAYS[m[2]] != null) {
    const target = WEEKDAYS[m[2]]
    const baseDelta = (target - today.getDay() + 7) % 7 // 0..6 to this week's occurrence
    // "this fri"/"fri" → the upcoming occurrence (min 1 day, so a same-weekday
    // today means next week). "next fri" → the occurrence a week after that.
    const delta = m[1] === 'next' ? baseDelta + 7 : (baseDelta === 0 ? 7 : baseDelta)
    return add(delta)
  }

  // "M/D" or "M/D/YY(YY)".
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) {
    const mo = parseInt(m[1], 10) - 1
    const day = parseInt(m[2], 10)
    let yr = m[3] ? parseInt(m[3], 10) : today.getFullYear()
    if (yr < 100) yr += 2000
    const d = new Date(yr, mo, day)
    if (d.getMonth() === mo && d.getDate() === day) {
      // No explicit year + already past → roll to next year.
      if (!m[3] && ymd(d) < ymd(today)) d.setFullYear(yr + 1)
      return ymd(d)
    }
  }

  return null
}
