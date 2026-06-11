import { localYMD } from '../dates'

// Cadence-window math for the Loops cards (design doc §13a): the
// visualization unit is the loop's own cycle, not the calendar day. A
// window is "caught" when any completed_history stamp lands inside it.
// Windows are anchored at the routine's creation date so they're stable
// across completions (mirrors the fixed-grid cadence philosophy), and the
// series always ends with the window containing today.

function windowOf(start, end, today, stamps) {
  const hits = stamps.filter(d => d >= start && d < end).length
  return {
    key: localYMD(start),
    start,
    end,
    hits,
    caught: hits > 0,
    current: today >= start && today < end,
  }
}

export function cycleWindows(routine, count = 12) {
  const cadence = routine.cadence || 'weekly'
  const stamps = (routine.completed_history || [])
    .map(ts => new Date(ts))
    .filter(d => Number.isFinite(d.getTime()))
  // Anchor: creation date, falling back to the oldest history stamp for
  // legacy rows without created_at — otherwise the series collapses to a
  // single "first cycle" window despite months of history.
  let created = routine.created_at ? new Date(routine.created_at) : null
  if ((!created || !Number.isFinite(created.getTime())) && stamps.length > 0) {
    created = new Date(Math.min(...stamps.map(d => d.getTime())))
  }
  if (created && !Number.isFinite(created.getTime())) created = null
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const stepDays = cadence === 'daily' ? 1
    : cadence === 'weekly' ? 7
    : cadence === 'custom' && routine.custom_unit !== 'months' ? Math.max(1, routine.custom_days || 7)
    : null
  const stepMonths = cadence === 'monthly' ? 1
    : cadence === 'quarterly' ? 3
    : cadence === 'annually' ? 12
    : cadence === 'custom' && routine.custom_unit === 'months' ? Math.max(1, routine.custom_days || 1)
    : null

  const windows = []
  if (stepDays != null) {
    const anchor = created
      ? new Date(created.getFullYear(), created.getMonth(), created.getDate())
      : today
    const sinceDays = Math.floor((today - anchor) / 86400000)
    const idx = Math.max(0, Math.floor(sinceDays / stepDays))
    for (let i = Math.max(0, idx - count + 1); i <= idx; i++) {
      const start = new Date(anchor); start.setDate(start.getDate() + i * stepDays)
      const end = new Date(start); end.setDate(end.getDate() + stepDays)
      windows.push(windowOf(start, end, today, stamps))
    }
  } else if (stepMonths != null) {
    const anchor = created
      ? new Date(created.getFullYear(), created.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1)
    const monthsSince = (today.getFullYear() - anchor.getFullYear()) * 12 + (today.getMonth() - anchor.getMonth())
    const idx = Math.max(0, Math.floor(monthsSince / stepMonths))
    for (let i = Math.max(0, idx - count + 1); i <= idx; i++) {
      const start = new Date(anchor); start.setMonth(start.getMonth() + i * stepMonths)
      const end = new Date(start); end.setMonth(end.getMonth() + stepMonths)
      windows.push(windowOf(start, end, today, stamps))
    }
  }
  return windows
}

// Habit-mode windows: target_period ('week' | 'month') buckets, hits from
// completed_history. weekStartsOn matches computeHabitStreak's default.
export function habitWindows(routine, count = 12, weekStartsOn = 1) {
  const stamps = (routine.completed_history || [])
    .map(ts => new Date(ts))
    .filter(d => Number.isFinite(d.getTime()))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const isWeek = routine.target_period !== 'month'

  const currentStart = new Date(today)
  if (isWeek) {
    const diff = (currentStart.getDay() - weekStartsOn + 7) % 7
    currentStart.setDate(currentStart.getDate() - diff)
  } else {
    currentStart.setDate(1)
  }

  const windows = []
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(currentStart)
    if (isWeek) start.setDate(start.getDate() - i * 7)
    else start.setMonth(start.getMonth() - i)
    const end = new Date(start)
    if (isWeek) end.setDate(end.getDate() + 7)
    else end.setMonth(end.getMonth() + 1)
    windows.push(windowOf(start, end, today, stamps))
  }
  return windows
}

export function cycleUnitLabel(routine, singular = false) {
  const c = routine.cadence
  const plural = (w) => (singular ? w : `${w}s`)
  if (c === 'daily') return plural('day')
  if (c === 'weekly') return plural('week')
  if (c === 'monthly') return plural('month')
  if (c === 'quarterly') return plural('quarter')
  if (c === 'annually') return plural('year')
  if (c === 'custom') {
    const n = Math.max(1, routine.custom_days || (routine.custom_unit === 'months' ? 1 : 7))
    if (routine.custom_unit === 'months') {
      return n === 1 ? plural('month') : `${n}-month ${plural('cycle')}`
    }
    return `${n}-day ${plural('cycle')}`
  }
  return plural('cycle')
}
