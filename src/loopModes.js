// Loop modes and the Loops screen's grouping (BOOM-35, 2026-11-15).
//
// Pure: routines, tasks and `now` in; modes and groups out. Anything that needs
// the cadence engine or habit math (store.js) is passed in as a function, so
// scripts/loopModes.test.mjs can pin every rule without a browser.
//
// Four modes, decided by what a loop already is. Nothing here keeps score.
//
//   reminder   a plain cadence loop (spawn_mode 'auto', no members): a task
//              shows up on Today when it's due; if a cycle slips it just waits.
//   checklist  a stack (members): a set of items at a time of day.
//   practice   a habit loop (spawn_mode 'habit'): no task; you log it.
//   autopilot  spawn_mode 'autopilot' (new, no migration: the column is
//              free text): something you already do. Boomerang never asks,
//              never spawns, never counts a miss. You can still log a day.
//
// Owner decisions (2026-11-15): autopilot is completely silent; missed reminder
// cycles get one quiet row, never a badge or banner; marking a day done on a
// loop's page also closes that cycle's open task.

export const AUTOPILOT = 'autopilot'
const OPEN = ['not_started', 'doing', 'in_progress', 'waiting']

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dueKey = (t) => (t.due_date ? String(t.due_date).slice(0, 10) : null)
const isStack = (r) => Array.isArray(r?.members) && r.members.length > 0

export function loopMode(routine) {
  if (!routine) return null
  if (routine.spawn_mode === AUTOPILOT) return 'autopilot'
  if (routine.spawn_mode === 'habit') return 'practice'
  if (isStack(routine)) return 'checklist'
  return 'reminder'
}

// Only a plain cadence loop (or one already on autopilot) can switch to and
// from autopilot. A checklist's items and a practice target are structural, so
// changing those goes through the loop editor.
export function canAutopilot(routine) {
  const m = loopMode(routine)
  return m === 'reminder' || m === 'autopilot'
}

export function withAutopilot(routine, on) {
  if (!canAutopilot(routine)) return routine
  const next = on ? AUTOPILOT : 'auto'
  if (routine.spawn_mode === next || (!on && !routine.spawn_mode)) return routine
  // Turning autopilot on also turns the loop's own alarm off: "won't remind
  // you" has to include the repeating phone alarm (reminderSchedule.js).
  return on ? { ...routine, spawn_mode: next, remind: false } : { ...routine, spawn_mode: next }
}

export const isResting = (r, now = new Date()) =>
  !!r?.paused || (!!r?.end_date && now.getTime() > new Date(`${r.end_date}T23:59:59`).getTime())

/**
 * Is this task one of the loop's own cycle tasks (as opposed to a follow-up
 * step, which inherits routine_id from the task that started its chain)?
 *
 * Follow-up steps carry no marker, so: a loop with follow-ups counts only
 * tasks titled like the loop (or like one of a checklist's items); a loop
 * without follow-ups has no steps, so every one of its tasks is a cycle task
 * (renamed ones included).
 */
export function isCycleTask(routine, t) {
  if (!routine || !t || t.routine_id !== routine.id || t.parent_id) return false
  if (!Array.isArray(routine.follow_ups) || routine.follow_ups.length === 0) return true
  if (t.title === routine.title) return true
  return isStack(routine) && routine.members.some(m => m.title === t.title)
}

const byDue = (a, b) => (dueKey(a) || '').localeCompare(dueKey(b) || '')

/**
 * The open tasks a "this got done on <ymd>" mark should close.
 *
 * reminder / autopilot: the loop's one open instance IS the current cycle (an
 * autopilot loop has one only if it was left over from before the switch). A
 * mark on or after that instance's due day (or on an undated instance) means
 * the cycle's work is done; a mark on an older day back-fills history and
 * leaves the current task alone.
 *
 * checklist: every open item of the latest cycle due on or before that day
 * (a cycle is one due date), so the whole checklist closes with one stamp.
 *
 * practice: none (a practice loop logs, it has no open instance).
 * Never a future day.
 */
export function openInstancesForDay({ routine, tasks = [], day, todayKey }) {
  const mode = loopMode(routine)
  if (!routine || !day || day > todayKey || mode === 'practice') return []
  const open = tasks.filter(t => OPEN.includes(t?.status) && isCycleTask(routine, t)).sort(byDue)
  if (mode === 'checklist') {
    const eligible = open.filter(t => !dueKey(t) || dueKey(t) <= day)
    if (!eligible.length) return []
    const cycle = eligible.map(t => dueKey(t) || day).sort().pop()
    return eligible.filter(t => (dueKey(t) || day) === cycle)
  }
  const t = open[0]
  if (!t) return []
  const due = dueKey(t)
  return !due || due <= day ? [t] : []
}

// Back-compat single-task form (reminder loops).
export function openInstanceForDay(args) {
  const list = loopMode(args?.routine) === 'reminder' ? openInstancesForDay(args) : []
  return list[0] || null
}

/**
 * The done cycle tasks a "that didn't happen on <ymd>" unmark should reopen:
 * tasks closed on that day, but only if they belong to the loop's LATEST cycle
 * (no newer cycle task exists). Reopening an old cycle's task would drop a
 * weeks-old task back onto Today; left closed, a just-unmarked latest cycle
 * would let the spawn pass mint a duplicate beside it.
 */
export function doneInstancesOnDay({ routine, tasks = [], day }) {
  if (!routine || !day || loopMode(routine) === 'practice') return []
  const own = tasks.filter(t => isCycleTask(routine, t))
  const closed = own.filter(t => t.status === 'done' && t.completed_at && ymd(new Date(t.completed_at)) === day)
  if (!closed.length) return []
  const newest = own.map(t => dueKey(t) || (t.created_at || '').slice(0, 10)).sort().pop()
  return closed.filter(t => (dueKey(t) || (t.created_at || '').slice(0, 10)) === newest)
}

/**
 * How many times a practice loop was done in [start, end): per local day, the
 * larger of its logged tasks and its completed_history stamps. Logs made with
 * "+ Log today" write both (one task, one stamp); a day marked on the loop's
 * calendar writes only a stamp. Counting only tasks ignored calendar marks,
 * counting only stamps would ignore logs made before stamping existed.
 */
export function practiceCount(routine, tasks = [], start, end) {
  if (!routine) return 0
  const lo = start.getTime(), hi = end.getTime()
  const inRange = (iso) => { const ms = new Date(iso).getTime(); return ms >= lo && ms < hi }
  const perDay = new Map()
  const bump = (key, field) => {
    const cur = perDay.get(key) || { tasks: 0, stamps: 0 }
    cur[field]++
    perDay.set(key, cur)
  }
  for (const t of tasks) {
    if (t?.routine_id === routine.id && !t.parent_id && t.completed_at && t.status === 'done' && inRange(t.completed_at)) bump(ymd(new Date(t.completed_at)), 'tasks')
  }
  for (const ts of routine.completed_history || []) {
    if (inRange(ts)) bump(ymd(new Date(ts)), 'stamps')
  }
  let n = 0
  for (const v of perDay.values()) n += Math.max(v.tasks, v.stamps)
  return n
}

// Did this loop get done on a local day (task closed that day, or stamped)?
export function doneOnDay(routine, tasks = [], day) {
  if (!routine) return false
  if ((routine.completed_history || []).some(ts => ymd(new Date(ts)) === day)) return true
  return tasks.some(t => t?.routine_id === routine.id && !t.parent_id && t.status === 'done' && t.completed_at && ymd(new Date(t.completed_at)) === day)
}

/**
 * Groups for the Loops screen.
 *
 * @param {object}   input
 * @param {object[]} input.routines
 * @param {object[]} input.tasks
 * @param {Date}     input.now
 * @param {function} input.nextDue     (routine) => Date   (store.getNextDueDate)
 * @param {function} input.habitStats  (routine, tasks) => { completions, target, period_end } | null
 * @param {function} [input.missedCount] (routine) => number of unrecorded/missed cycles
 */
export function groupLoops({ routines = [], tasks = [], now = new Date(), nextDue, habitStats, missedCount = () => 0 } = {}) {
  const todayKey = ymd(now)
  const g = { dueToday: [], checklists: [], practice: [], comingUp: [], autopilot: [], resting: [], slipped: [] }
  const byRoutine = new Map()
  const routineById = new Map(routines.filter(Boolean).map(r => [r.id, r]))
  for (const t of tasks) {
    if (!t?.routine_id || t.parent_id) continue
    if (!isCycleTask(routineById.get(t.routine_id), t)) continue
    if (!byRoutine.has(t.routine_id)) byRoutine.set(t.routine_id, [])
    byRoutine.get(t.routine_id).push(t)
  }
  const doneOn = (t, key) => t.status === 'done' && t.completed_at && ymd(new Date(t.completed_at)) === key
  const stampedToday = (r) => (r.completed_history || []).some(ts => ymd(new Date(ts)) === todayKey)

  for (const r of routines) {
    if (!r) continue
    if (isResting(r, now)) { g.resting.push({ routine: r }); continue }
    const mode = loopMode(r)
    const own = byRoutine.get(r.id) || []

    if (mode === 'autopilot') { g.autopilot.push({ routine: r, doneToday: stampedToday(r) }); continue }

    if (mode === 'practice') {
      const s = habitStats ? habitStats(r, tasks) : null
      g.practice.push({ routine: r, done: s?.completions ?? 0, target: s?.target ?? r.target_count ?? null, loggedToday: own.some(t => doneOn(t, todayKey)) || stampedToday(r) })
      continue
    }

    if (mode === 'checklist') {
      const today = own.filter(t => dueKey(t) === todayKey)
      // Due today if today's items exist or an earlier cycle is still open;
      // otherwise the next date it comes back, so a weekly checklist doesn't
      // read "tonight" on a Tuesday.
      const openEarlier = own.some(t => OPEN.includes(t.status) && dueKey(t) && dueKey(t) < todayKey)
      const next = nextDue ? nextDue(r) : null
      const nextKey = next && Number.isFinite(next.getTime()) ? ymd(next) : null
      const due = today.length > 0 || openEarlier || (nextKey != null && nextKey <= todayKey)
      g.checklists.push({ routine: r, items: r.members.length, doneToday: today.filter(t => t.status === 'done').length, spawnedToday: today.length, dueToday: due, next: due ? todayKey : nextKey })
      if (missedCount(r) > 0) g.slipped.push({ routine: r, count: missedCount(r) })
      continue
    }

    // reminder
    const open = own.filter(t => OPEN.includes(t.status)).sort((a, b) => (dueKey(a) || '').localeCompare(dueKey(b) || ''))
    const current = open[0] || null
    const doneTask = own.find(t => doneOn(t, todayKey)) || null
    if ((current && (!dueKey(current) || dueKey(current) <= todayKey)) || doneTask) {
      g.dueToday.push({ routine: r, task: current && (!dueKey(current) || dueKey(current) <= todayKey) ? current : null, doneTask })
    } else {
      const next = nextDue ? nextDue(r) : null
      const key = current ? dueKey(current) : (next && Number.isFinite(next.getTime()) ? ymd(next) : null)
      g.comingUp.push({ routine: r, due: key, task: current })
    }
    if (missedCount(r) > 0) g.slipped.push({ routine: r, count: missedCount(r) })
  }

  const byTitle = (a, b) => String(a.routine.title).localeCompare(String(b.routine.title))
  g.dueToday.sort((a, b) => (a.task ? 0 : 1) - (b.task ? 0 : 1) || byTitle(a, b))
  g.checklists.sort((a, b) => String(a.routine.trigger_time || '99').localeCompare(String(b.routine.trigger_time || '99')) || byTitle(a, b))
  g.practice.sort(byTitle)
  g.comingUp.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || byTitle(a, b))
  g.autopilot.sort(byTitle)
  g.resting.sort(byTitle)
  g.slipped.sort(byTitle)
  return g
}

// ── Labels (pure, so the tests can pin them) ─────────────────────────────

const CADENCE_WORD = { daily: 'daily', weekly: 'weekly', monthly: 'monthly', quarterly: 'every 3 months', annually: 'yearly' }
const CADENCE_EVERY = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month', quarterly: 'Every 3 months', annually: 'Every year' }

// "daily", "weekly", "every 3 days", "every 2 months".
export function cadenceWord(r) {
  if (!r) return ''
  if (r.cadence === 'custom') {
    const n = Number(r.custom_days) || 1
    const unit = r.custom_unit === 'months' ? 'month' : 'day'
    return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`
  }
  return CADENCE_WORD[r.cadence] || r.cadence || ''
}

// "Every week, Sun" — `anchor` is store.formatScheduleAnchor(r).
export function scheduleLabel(r, anchor = '') {
  if (!r) return ''
  const base = r.cadence === 'custom'
    ? cadenceWord(r).replace(/^e/, 'E')
    : (CADENCE_EVERY[r.cadence] || cadenceWord(r))
  return anchor ? `${base}, ${anchor}` : base
}

// "21:00" → "9:00 PM". Returns null for anything that isn't HH:MM.
export function clockLabel(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''))
  if (!m) return null
  const h = Number(m[1])
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// The most recent completed_history day as a word: "today", "yesterday",
// "Nov 3", or null if never.
export function lastDoneWord(r, now = new Date()) {
  const last = (r?.completed_history || []).map(ts => new Date(ts)).filter(d => Number.isFinite(d.getTime()))
    .sort((a, b) => b - a)[0]
  if (!last) return null
  const key = ymd(last)
  const today = ymd(now)
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (key === today) return 'today'
  if (key === ymd(y)) return 'yesterday'
  return last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
