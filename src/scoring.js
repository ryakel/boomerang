// Completion counting, plus the impact ranker (impactRank, below).
//
// Points were removed from the product on 2026-11-15 (BOOM-33): no task,
// session, escalation attempt, stack clear or easter-egg win is worth a
// score any more, and rally (the day streak) went with them. What survives is
// the COUNT of things that got done, which Analytics and the daily task goal
// still use. Old rows may still carry legacy point fields (`stack_bonus`,
// `session_log[].points`, `escalation_attempt_log[].points`); nothing reads
// them and nothing deletes them.

// Project sessions logged today across the whole task list. Each logged
// session counts as a "task" for the day, so chipping at a project shows up
// the same as completing a one-shot task.
export function computeSessionStatsToday(tasks) {
  const todayStr = new Date().toDateString()
  let count = 0
  for (const t of tasks) {
    if (t.status !== 'project') continue
    const log = Array.isArray(t.session_log) ? t.session_log : []
    for (const entry of log) {
      if (!entry?.timestamp) continue
      if (new Date(entry.timestamp).toDateString() !== todayStr) continue
      count += 1
    }
  }
  return { count }
}

// Escalation-ladder attempts logged today, across every task (active ladder
// or not: a closed ladder's history still counts for the day the attempt
// happened). Sent the email, made the call: real effort even without
// resolution.
export function computeEscalationStatsToday(tasks) {
  const todayStr = new Date().toDateString()
  let count = 0
  for (const t of tasks) {
    const log = Array.isArray(t.escalation_attempt_log) ? t.escalation_attempt_log : []
    for (const entry of log) {
      if (!entry?.at) continue
      if (new Date(entry.at).toDateString() !== todayStr) continue
      count += 1
    }
  }
  return { count }
}

// How many things got done today. Optional `settings` adds the easter egg:
// winning the hidden tic-tac-toe game (7-tap the EditTaskModal title) stamps
// `easter_egg_wins[today] = true` and counts as one thing done, once a day.
// Moving a task to waiting, logging a project session and logging an
// escalation attempt also count.
export function computeDailyStats(tasks, settings = null) {
  const now = new Date()
  const todayStr = now.toDateString()
  // Local YMD — UTC variant would flip to "tomorrow" at night Central
  // time and miss easter-egg wins / mismatch other systems that key by
  // local calendar date.
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayTasks = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr)
  const waitingToday = tasks.filter(t => t.status === 'waiting' && t.waiting_at && new Date(t.waiting_at).toDateString() === todayStr)

  const sessions = computeSessionStatsToday(tasks)
  const escalations = computeEscalationStatsToday(tasks)
  const eggBonus = settings?.easter_egg_wins?.[todayIso] ? 1 : 0

  return {
    tasksToday: todayTasks.length + waitingToday.length + sessions.count + escalations.count + eggBonus,
  }
}

// Best day ever, by number of tasks completed.
export function computeRecords(tasks) {
  const byDay = {}
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      const dayStr = new Date(t.completed_at).toDateString()
      byDay[dayStr] = (byDay[dayStr] || 0) + 1
    }
  }
  let bestTasks = 0
  for (const n of Object.values(byDay)) if (n > bestTasks) bestTasks = n
  return { bestTasks }
}

// A project accepts at most this many logged sessions. Kept in sync with the
// server-side constant in db.js, which enforces it.
export const PROJECT_SESSION_CAP = 10

// --- Impact ranking (see wiki/Crisis-Tag-And-Impact-Ranking.md) ---
//
// One pure scorer every surface consumes (Today ordering, Tasks "Impact"
// sort, Next-up toast) so "what matters most right now" is a single number:
//
//   crisis                → CRISIS_RANK, always sorts above everything
//   base                  = (impact ?? 2) × 100    (null = never inferred →
//                           displays/scores as the 2 baseline, lazy backfill)
//   + due proximity       overdue 80 / today 60 / tomorrow 40 / this week 20
//   + weather window      50 when the task is outdoor AND today is one of the
//                           good days before a bad stretch (ctx-computed —
//                           see computeWeatherWindow in WeatherSection.jsx)
//   + event proximity     0→50 ramping over an impact_date's lead_days when
//                           the task shares the event's tag
//   − stale decay         up to −15 past 14 days untouched, so ancient tasks
//                           don't win on boosts alone
//
// Pure JS, no imports — node unit tests (scripts/impact.test.mjs) exercise it
// directly. All context arrives via `ctx`:
//   { todayYmd, isCrisis(task), isOutdoor(task), weatherWindowActive,
//     impactDates: [{date:'YYYY-MM-DD', lead_days, tag}], nowMs }
export const CRISIS_RANK = 100000

export function impactRank(task, ctx = {}) {
  if (ctx.isCrisis && ctx.isCrisis(task)) return CRISIS_RANK

  let score = (task.impact ?? 2) * 100

  // Due proximity
  const today = ctx.todayYmd || null
  if (task.due_date && today) {
    const due = String(task.due_date).slice(0, 10)
    const diffDays = daysBetweenYmd(today, due)
    if (diffDays < 0) score += 80
    else if (diffDays === 0) score += 60
    else if (diffDays === 1) score += 40
    else if (diffDays <= 7) score += 20
  }

  // Closing weather window — outdoor task + a good day now before bad days
  if (ctx.weatherWindowActive && ctx.isOutdoor && ctx.isOutdoor(task)) {
    score += 50
  }

  // Event proximity — impact_dates entries with a tag this task carries.
  // Boost ramps linearly from 0 (lead_days out) to 50 (event day); expired
  // events contribute nothing.
  if (Array.isArray(ctx.impactDates) && ctx.impactDates.length > 0 && Array.isArray(task.tags) && today) {
    let best = 0
    for (const ev of ctx.impactDates) {
      if (!ev?.date || !ev.tag || !task.tags.includes(ev.tag)) continue
      const lead = Math.max(1, ev.lead_days || 14)
      const daysOut = daysBetweenYmd(today, String(ev.date).slice(0, 10))
      if (daysOut < 0 || daysOut > lead) continue
      best = Math.max(best, Math.round(50 * (1 - daysOut / lead)))
    }
    score += best
  }

  // Stale decay
  if (task.created_at) {
    const now = ctx.nowMs || Date.now()
    const ageDays = Math.floor((now - new Date(task.created_at).getTime()) / 86400000)
    if (ageDays > 14) score -= Math.min(15, ageDays - 14)
  }

  return score
}

// Whole-day difference between two 'YYYY-MM-DD' strings (b - a), computed in
// UTC so DST transitions can't produce off-by-one days.
function daysBetweenYmd(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

