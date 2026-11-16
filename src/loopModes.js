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
  return { ...routine, spawn_mode: next }
}

export const isResting = (r, now = new Date()) =>
  !!r?.paused || (!!r?.end_date && now.getTime() > new Date(`${r.end_date}T23:59:59`).getTime())

/**
 * The open task a "this got done on <ymd>" mark should close, or null.
 *
 * Only for reminder loops: their one open instance IS the current cycle. A mark
 * on or after that instance's due day (or on an undated instance) means the
 * cycle's work is done; a mark on an older day is back-filling history and
 * leaves the current task alone. Never a future day.
 */
export function openInstanceForDay({ routine, tasks = [], day, todayKey }) {
  if (!routine || loopMode(routine) !== 'reminder' || !day || day > todayKey) return null
  const open = tasks
    .filter(t => t && t.routine_id === routine.id && !t.parent_id && OPEN.includes(t.status))
    .sort((a, b) => (dueKey(a) || '').localeCompare(dueKey(b) || ''))
  const t = open[0]
  if (!t) return null
  const due = dueKey(t)
  return !due || due <= day ? t : null
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
  for (const t of tasks) {
    if (!t?.routine_id || t.parent_id) continue
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
      g.practice.push({ routine: r, done: s?.completions ?? 0, target: s?.target ?? r.target_count ?? null, loggedToday: own.some(t => doneOn(t, todayKey)) })
      continue
    }

    if (mode === 'checklist') {
      const today = own.filter(t => dueKey(t) === todayKey)
      g.checklists.push({ routine: r, items: r.members.length, doneToday: today.filter(t => t.status === 'done').length, spawnedToday: today.length })
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
