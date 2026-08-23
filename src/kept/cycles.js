import { localYMD } from '../dates.js'

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

// --- Away windows ------------------------------------------------------
//
// A cycle you were away for is neither missed nor kept — the same rule the
// streak settled on (2026-08-03, "this shit should be actually paused").
//
// The away window has protected notifications, then the streak, then the
// device's own alarms. Loops were the consumer nobody wired up: a week away
// produced a `missed` gap for every daily cycle in it and reset every rally
// to zero, and nothing in the repair path could clear them — `reconcile_loops`
// only stamps days that a FINISHED task already proves, and there is no
// finished task for a day you were on holiday. Hence "a bunch of loops broke
// because of my vacation and I seem to have no way to fix them."
//
// `awayDays` is the same stamped `settings.away_days` list the streak and the
// device alarms read, so all four surfaces agree by construction.
//
// PAUSED means the cycle's DUE DAY was an away day. One cycle, one day, checked
// straight against the away list — "it should match the days away, full stop."
//
// The two rules this replaces both failed a real requirement (user, 2026-08-11:
// "no misses because it didn't overlap and no month long gaps"):
//
//   every-elapsed-day-away  — a weekly cycle due mid-trip stayed MISSED because
//                             the tail of its window ran past the trip. A miss
//                             manufactured by the window not lining up with the
//                             holiday, which is not a thing the user did wrong.
//   any-day-of-window-away  — one day away excused a monthly loop's whole month.
//
// The due day is the window START, which is already the day the UI labels the
// gap with and the day "Mark done" stamps — so what gets excused is exactly the
// day you'd otherwise be asked to answer for. A monthly loop due on the 15th is
// excused only if you were away on the 15th.
export function isWindowPaused(w, awayDays) {
  if (!w || !awayDays || awayDays.size === 0) return false
  return awayDays.has(w.key ?? localYMD(w.start))
}

const toDaySet = (awayDays) => (
  awayDays instanceof Set ? awayDays : new Set(Array.isArray(awayDays) ? awayDays : [])
)

/**
 * Which away windows the trail should BRIDGE — drawn as a connector running
 * through the break rather than a row of hollow "missed" squares.
 *
 * Only bridged when the loop actually came back: there must be a caught window
 * LATER in the series. A trip you never resumed after isn't a continuous loop
 * with a gap in it, it's a loop that stopped, and a pretty connector over that
 * would be the chart telling a nicer story than the truth.
 *
 * Returns a Set of window keys.
 */
export function bridgedAwayKeys(windows = [], awayDays = null) {
  const away = toDaySet(awayDays)
  if (away.size === 0) return new Set()
  const out = new Set()
  let caughtAfter = false
  // Backwards, so "is there a completion later" is just a running flag.
  for (let i = windows.length - 1; i >= 0; i--) {
    const w = windows[i]
    if (w.hits > 0) { caughtAfter = true; continue }
    if (caughtAfter && isWindowPaused(w, away)) out.add(w.key)
  }
  return out
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
      : new Date(today)
    // Weekly routines with an explicit weekday anchor align the 7-day grid to
    // that weekday — mirroring getNextDueDate's fixed grid. Without this, a
    // routine created mid-week put the window boundaries on the wrong day, so a
    // completion on the scheduled weekday could fall across two windows: a done
    // cycle read as MISSED and "Mark done" stamped the window start (wrong
    // weekday). Move the anchor FORWARD to the first scheduled weekday on/after
    // creation (not backward — that would mint a leading window predating the
    // routine, a fresh false-missed) so every boundary lands on it.
    const sdow = Number(routine.schedule_day_of_week)
    if (cadence === 'weekly' && Number.isInteger(sdow) && sdow >= 0 && sdow <= 6) {
      anchor.setDate(anchor.getDate() + ((sdow - anchor.getDay() + 7) % 7))
    }
    const sinceDays = Math.floor((today - anchor) / 86400000)
    // sinceDays < 0 means the forward-shifted anchor's first cycle hasn't
    // started yet (e.g. a routine created today with a schedule_day_of_week
    // that already passed this calendar week — the anchor lands next week).
    // The old Math.max(0, ...) clamp forced idx to 0 in that case, minting a
    // FUTURE window (start > today) that's neither current nor caught, which
    // loopGaps() then had no way to distinguish from a genuinely missed past
    // cycle — a brand-new routine immediately showed "1 to fix." No windows
    // exist yet when the first cycle hasn't started.
    if (sinceDays >= 0) {
      const idx = Math.floor(sinceDays / stepDays)
      for (let i = Math.max(0, idx - count + 1); i <= idx; i++) {
        const start = new Date(anchor); start.setDate(start.getDate() + i * stepDays)
        const end = new Date(start); end.setDate(end.getDate() + stepDays)
        windows.push(windowOf(start, end, today, stamps))
      }
    }
  } else if (stepMonths != null) {
    const anchor = created
      ? new Date(created.getFullYear(), created.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), 1)
    const monthsSince = (today.getFullYear() - anchor.getFullYear()) * 12 + (today.getMonth() - anchor.getMonth())
    // Same fix as the day-stepped branch above: a future anchor (monthsSince
    // < 0) means the first cycle hasn't started — no windows yet.
    if (monthsSince >= 0) {
      const idx = Math.floor(monthsSince / stepMonths)
      for (let i = Math.max(0, idx - count + 1); i <= idx; i++) {
        const start = new Date(anchor); start.setMonth(start.getMonth() + i * stepMonths)
        const end = new Date(start); end.setMonth(end.getMonth() + stepMonths)
        windows.push(windowOf(start, end, today, stamps))
      }
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

// Per-loop reconcile gaps — the days a loop "needs you to look at" (plan
// follow-up). Walks the cadence windows and splits past, non-current,
// uncaught cycles into two groups:
//   - unrecorded: a finished task exists in the window but the loop never
//     recorded it (the reconcile case) — review before crediting.
//   - missed: the cycle was due but has no completion AND no finished task.
// Days the user already acknowledged (Skip) sit in `routine.skipped_days` and
// are excluded. Each entry carries the representative local day used to stamp
// (Mark done) or dismiss (Skip), plus a human label. Stacks are reconciled by
// their own (routine_id, due_date) cycle rule (see below); habit loops return
// empty (no single closeable cycle).
const GAP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function gapLabel(routine, w) {
  const s = w.start
  const monthScale = ['monthly', 'quarterly', 'annually'].includes(routine.cadence)
    || (routine.cadence === 'custom' && routine.custom_unit === 'months')
  if (monthScale) {
    if (routine.cadence === 'annually') return String(s.getFullYear())
    return `${GAP_MONTHS[s.getMonth()]} ${s.getFullYear()}`
  }
  // day/week windows: show the start day (week windows read as "week of")
  const day = `${GAP_MONTHS[s.getMonth()]} ${s.getDate()}`
  const weekScale = routine.cadence === 'weekly'
    || (routine.cadence === 'custom' && routine.custom_unit !== 'months' && (routine.custom_days || 7) > 1)
  return weekScale ? `week of ${day}` : day
}

function ymdDayLabel(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return ymd
  return `${GAP_MONTHS[m - 1]} ${d}`
}

export function loopGaps(routine, tasks = [], count = 12, awayDays = null) {
  if (!routine || routine.spawn_mode === 'habit') return { unrecorded: [], missed: [], away: [] }
  const away = toDaySet(awayDays)
  const skipped = new Set(Array.isArray(routine.skipped_days) ? routine.skipped_days : [])
  const histDays = new Set((routine.completed_history || []).map(ts => localYMD(new Date(ts))))

  // Stacks close per (routine_id, due_date) cycle — every member done. A cycle
  // where all members are done but completed_history was never stamped (the
  // last-member-clear stamp didn't land — completed from the main list, a
  // refetch race, or pre-fix completions) is an UNRECORDED gap, fixable by
  // stamping that day. Partial cycles (not all members done) are genuinely
  // incomplete and left alone. (Bug: a fully-cleared Bedtime cycle showed the
  // day blank because stacks were excluded from reconcile entirely.)
  const isStack = Array.isArray(routine.members) && routine.members.length > 0
  if (isStack) {
    const today = localYMD()
    const byCycle = new Map()
    for (const t of tasks) {
      if (t.routine_id !== routine.id) continue
      const due = String(t.due_date || '').slice(0, 10)
      if (!due || due >= today) continue // only past cycles
      if (['cancelled', 'backlog', 'project'].includes(t.status)) continue
      if (!byCycle.has(due)) byCycle.set(due, { due, total: 0, done: 0, lastIso: null })
      const c = byCycle.get(due)
      c.total++
      if (t.status === 'done') {
        c.done++
        const iso = t.completed_at || `${due}T12:00:00.000Z`
        if (!c.lastIso || iso > c.lastIso) c.lastIso = iso
      }
    }
    const unrecorded = []
    for (const c of byCycle.values()) {
      if (c.total === 0 || c.done < c.total) continue // partial / incomplete cycle
      if (histDays.has(c.due) || skipped.has(c.due)) continue
      unrecorded.push({ key: c.due, day: c.due, iso: new Date(c.lastIso).toISOString(), label: ymdDayLabel(c.due), taskId: null })
    }
    unrecorded.sort((a, b) => b.day.localeCompare(a.day))
    return { unrecorded, missed: [], away: [] }
  }

  const doneTasks = tasks.filter(t => t.routine_id === routine.id && t.status === 'done')
  const wins = cycleWindows(routine, count)
  const unrecorded = []
  const missed = []
  const away_ = []
  for (const w of wins) {
    if (w.current || w.caught) continue
    const task = doneTasks.find(t => {
      const iso = t.completed_at || (t.due_date ? `${String(t.due_date).slice(0, 10)}T12:00:00.000Z` : null)
      if (!iso) return false
      const d = new Date(iso)
      return d >= w.start && d < w.end
    })
    if (task) {
      const iso = task.completed_at || `${String(task.due_date).slice(0, 10)}T12:00:00.000Z`
      const day = localYMD(new Date(iso))
      if (skipped.has(day) || skipped.has(w.key)) continue
      unrecorded.push({ key: w.key, day, iso: new Date(iso).toISOString(), label: gapLabel(routine, w), taskId: task.id })
    } else {
      if (skipped.has(w.key)) continue
      // A cycle you were away for was never yours to MISS — but it isn't
      // nothing either. It goes in its own bucket so the loop can offer to
      // reschedule ("push it out") rather than silently swallowing the gap.
      // It stays out of `missed`, so the rally protection and the "N to fix"
      // badge are unaffected.
      if (isWindowPaused(w, away)) {
        away_.push({ key: w.key, day: w.key, iso: `${w.key}T12:00:00.000Z`, label: gapLabel(routine, w) })
        continue
      }
      missed.push({ key: w.key, day: w.key, iso: `${w.key}T12:00:00.000Z`, label: gapLabel(routine, w) })
    }
  }
  away_.sort((a, b) => b.day.localeCompare(a.day))
  return { unrecorded, missed, away: away_ }
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

// Consecutive-cycle rally + best, from a window series (oldest -> newest).
// The CURRENT window only extends the rally when already caught — an
// in-flight cycle you haven't hit yet doesn't break anything.
export function cycleRally(windows, target = 1, awayDays = null) {
  const away = toDaySet(awayDays)
  // A cycle spent away neither breaks the rally nor extends it — step over it,
  // exactly as the streak walk steps over an away day.
  const paused = (w) => w.hits < target && isWindowPaused(w, away)
  const closed = windows.filter(w => !w.current)
  const cur = windows[windows.length - 1]
  let rally = cur && cur.current && cur.hits >= target ? 1 : 0
  for (let i = closed.length - 1; i >= 0; i--) {
    if (closed[i].hits >= target) rally++
    else if (paused(closed[i])) continue
    else break
  }
  let best = 0, run = 0
  for (const w of closed) {
    if (w.hits >= target) { run++; best = Math.max(best, run) }
    else if (paused(w)) continue
    else run = 0
  }
  if (cur && cur.current && cur.hits >= target) best = Math.max(best, rally)
  return { rally, best }
}
