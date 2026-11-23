// The weekly review and the week's priorities (BOOM-59). Pure: tasks and the
// local day key in, the review's state and the week's priorities out.
//
// Owner, 2026-11-23: "Every Friday, 15 min: clear Inbox, pick 2–3 priorities."
// The review is offered on Friday and stays offered through the weekend, then
// quietly goes away. It never notifies and nothing counts it: there is no
// streak and no tally of reviews done (the no-points rule).
//
// A priority is a task whose `week_priority` is the Monday of the week it was
// picked for. Picking on Friday, Saturday or Sunday plans the COMING week;
// picking Monday to Thursday plans the current one. Done or removed tasks drop
// off on their own, and a stale week_priority from an old week is ignored.

export const MAX_PRIORITIES = 3
const ACTIVE = new Set(['not_started', 'doing', 'waiting', 'open', 'in_progress'])
const REVIEW_DAYS = new Set([5, 6, 0]) // Fri, Sat, Sun

const parse = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12) }
const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const addDays = (key, n) => { const d = parse(key); d.setDate(d.getDate() + n); return keyOf(d) }

// The Monday of the week holding this day (weeks run Monday to Sunday).
export function weekStart(dayKey) {
  const dow = parse(dayKey).getDay()
  return addDays(dayKey, dow === 0 ? -6 : 1 - dow)
}
export const isReviewDay = (dayKey) => REVIEW_DAYS.has(parse(dayKey).getDay())
// The week a review done today plans.
export const reviewWeek = (dayKey) => isReviewDay(dayKey) ? addDays(weekStart(dayKey), 7) : weekStart(dayKey)

const open = (t) => t && ACTIVE.has(t.status) && !t.gmail_pending && t.status !== 'project'

// This week's priorities, in the order they were picked (title as tiebreak).
export function weekPriorities(tasks, dayKey) {
  const week = weekStart(dayKey)
  return (tasks || []).filter(t => open(t) && t.week_priority === week)
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
}

// What Today shows for the review today:
//   'offer'   a review day, nothing picked for the coming week, not skipped
//   'planned' a review day and the coming week has priorities
//   null      any other day, or skipped this weekend
export function reviewState({ tasks, dayKey, skippedWeek = null }) {
  if (!isReviewDay(dayKey)) return { state: null }
  const week = reviewWeek(dayKey)
  const picked = (tasks || []).filter(t => open(t) && t.week_priority === week)
  if (picked.length) return { state: 'planned', week, picked }
  if (skippedWeek === week) return { state: null, week }
  return { state: 'offer', week }
}

// Tasks worth considering as priorities for `week`, best first, each with a
// short plain reason. Already-picked ones first, then this week's unfinished
// priorities (carry over), then high priority, due that week, kept on Today,
// and overdue. Everything else open is still pickable from the full list.
export function priorityCandidates(tasks, dayKey, week = reviewWeek(dayKey)) {
  const weekEnd = addDays(week, 6)
  const thisWeek = weekStart(dayKey)
  const out = []
  for (const t of tasks || []) {
    if (!open(t)) continue
    const due = t.due_date || null
    let rank = null, why = null
    if (t.week_priority === week) { rank = 0; why = 'picked' }
    else if (t.week_priority && t.week_priority === thisWeek && week !== thisWeek) { rank = 1; why = 'this week’s priority' }
    else if (t.high_priority) { rank = 2; why = 'high priority' }
    else if (due && due >= week && due <= weekEnd) { rank = 3; why = 'due that week' }
    else if (t.pinned_to_today) { rank = 4; why = 'kept on Today' }
    else if (due && due < dayKey) { rank = 5; why = 'overdue' }
    if (rank == null) continue
    out.push({ task: t, rank, why, due })
  }
  return out.sort((a, b) => a.rank - b.rank || (a.due || '9999').localeCompare(b.due || '9999') || (a.task.title || '').localeCompare(b.task.title || ''))
}

// The writes a review's picks need: set the week on the picked, clear it on
// tasks that held it for that week and were un-picked. Picks beyond the cap
// are refused, not truncated silently.
export function priorityUpdates(tasks, week, pickedIds) {
  const picked = new Set(pickedIds)
  if (picked.size > MAX_PRIORITIES) throw new Error(`Pick at most ${MAX_PRIORITIES}.`)
  const updates = []
  for (const t of tasks || []) {
    if (picked.has(t.id) && t.week_priority !== week) updates.push([t.id, { week_priority: week }])
    else if (!picked.has(t.id) && t.week_priority === week) updates.push([t.id, { week_priority: null }])
  }
  return updates
}

// Next week at a glance for the review: tasks due in `week`, by day.
export function dueInWeek(tasks, week) {
  const end = addDays(week, 6)
  return (tasks || []).filter(t => open(t) && t.due_date && t.due_date >= week && t.due_date <= end)
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || (a.title || '').localeCompare(b.title || ''))
}
