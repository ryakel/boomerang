// The Tasks list's Upcoming tab, on Kept 2.0 rules (BOOM-37, 2026-11-15).
//
// Pure: tasks, routines and `now` in; groups out. No React, no storage, no
// clock reads, so scripts/tasksModel.test.mjs can pin every rule.
//
// The rules follow Today (src/todayModel.js, wiki/Today-Kept2.md §0): a due
// date is evidence of relevance, not an alarm. Something past its date is
// "slipped": quiet, neutral, offered a new day or letting go, never painted
// red. Only a task tagged critical keeps urgent styling. Every task lands in
// exactly one group, and the Worth doing next pick (passed in as `excludeIds`)
// is left out so it never shows twice.
//
// Group order (the approved mockup): critical → today → week → slipped →
// later → started → anytime → waiting.

import { WAITING_CHECKIN_DAYS } from './todayModel.js'

export const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting', 'in_progress']
export const STARTED_STATUSES = ['doing', 'in_progress']
export const WEEK_DAYS = 7          // "This week" = due in the next 7 days
export const SLIPPED_SHOWN = 3      // rows shown before "Show N more"
export const ANYTIME_SHOWN = 5

const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dayMs = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000)
export const addDaysKey = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}
const dueKey = (t) => (t.due_date ? String(t.due_date).slice(0, 10) : null)
const ms = (iso) => (iso ? new Date(iso).getTime() : NaN)
const isSnoozed = (t, nowMs) => !!t.snoozed_until && ms(t.snoozed_until) > nowMs

/**
 * @param {object}   input
 * @param {object[]} input.tasks
 * @param {object[]} input.routines
 * @param {Date}     input.now
 * @param {Set|Array} [input.excludeIds]   ids shown elsewhere (the Worth doing next pick)
 * @param {function} [input.isCrisis]      (task) => boolean
 * @returns {{ critical, today, week, slipped, later, started, anytime, waiting }}
 */
export function groupUpcoming({ tasks = [], routines = [], now = new Date(), excludeIds = [], isCrisis = () => false } = {}) {
  const todayKey = ymd(now)
  const nowMs = now.getTime()
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
  const routineById = new Map(routines.map(r => [r.id, r]))
  const isStack = (r) => !!r && Array.isArray(r.members) && r.members.length > 0

  const g = { critical: [], today: [], week: [], slipped: [], later: [], started: [], anytime: [], waiting: [] }

  for (const t of tasks) {
    if (!t || t.parent_id || t.gmail_pending) continue
    if (!ACTIVE_STATUSES.includes(t.status)) continue
    if (isSnoozed(t, nowMs)) continue
    if (exclude.has(t.id)) continue
    const routine = t.routine_id ? routineById.get(t.routine_id) : null
    // Stack members live in Today's checklist folder, as they always have here.
    if (isStack(routine)) continue

    const due = dueKey(t)
    if (isCrisis(t)) { g.critical.push({ task: t, due }); continue }

    if (t.status === 'waiting') {
      const since = t.waiting_at || t.last_touched || t.created_at
      const days = since ? Math.max(0, daysBetween(ymd(new Date(since)), todayKey)) : null
      g.waiting.push({ task: t, due, days, checkIn: days != null && days >= WAITING_CHECKIN_DAYS })
      continue
    }

    // A loop's open instance is the current cycle: today, however late.
    if (routine && (!due || due <= todayKey)) { g.today.push({ task: t, due, routine }); continue }

    if (due) {
      if (due === todayKey || t.committed_on === todayKey) g.today.push({ task: t, due })
      else if (due < todayKey) g.slipped.push({ task: t, due, daysAgo: daysBetween(due, todayKey) })
      else if (daysBetween(todayKey, due) <= WEEK_DAYS) g.week.push({ task: t, due, routine })
      else g.later.push({ task: t, due, routine })
      continue
    }

    if (t.committed_on === todayKey) g.today.push({ task: t, due })
    else if (STARTED_STATUSES.includes(t.status)) g.started.push({ task: t, due })
    else g.anytime.push({ task: t, due })
  }

  const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || String(a.task.title).localeCompare(String(b.task.title))
  g.critical.sort(byDue)
  g.today.sort((a, b) => (a.routine ? 0 : 1) - (b.routine ? 0 : 1) || byDue(a, b))
  g.week.sort(byDue)
  g.slipped.sort(byDue)                       // oldest first, like Today's review
  g.later.sort(byDue)
  g.started.sort((a, b) => String(b.task.last_touched || '').localeCompare(String(a.task.last_touched || '')))
  g.anytime.sort((a, b) => String(b.task.created_at || '').localeCompare(String(a.task.created_at || '')))
  g.waiting.sort((a, b) => (b.days ?? -1) - (a.days ?? -1))
  return g
}

// The one-tap new days offered on a slipped row.
export function slippedChoices(now = new Date()) {
  const todayKey = ymd(now)
  return [
    { key: 'tomorrow', label: 'Tomorrow', ymd: addDaysKey(todayKey, 1) },
    { key: 'next-week', label: 'Next week', ymd: addDaysKey(todayKey, 7) },
  ]
}
