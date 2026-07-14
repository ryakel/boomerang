// Centralized point-scoring logic.
// Single source of truth for how task points are calculated.
//
// Formula: SIZE_POINTS[size] × ENERGY_MULTIPLIER[energyLevel] × speedMultiplier
//
// speedMultiplier rewards fast completion:
//   same day = 2x, within 2 days = 1.5x, otherwise = 1x
//
// energyMultiplier rewards tackling hard tasks:
//   level 1 = 1.0x, level 2 = 1.5x, level 3 = 2.0x

const SIZE_POINTS = { XS: 1, S: 2, M: 5, L: 10, XL: 20 }
const ENERGY_MULTIPLIER = { 1: 1.0, 2: 1.5, 3: 2.0 }

// Calculate points for a single task.
// Uses completed_at if available, otherwise assumes "now" (for previewing points).
//
// Assigned tasks (task.assignee set — e.g. a kid's chore the user supervises
// rather than their own task, migration 038) score a flat 1 point instead of
// the size x energy x speed formula: it's a simple did-it-or-didn't chore,
// not graded ADHD-effort. Still counts toward the user's own daily total —
// only the per-task amount changes.
export function calculateTaskPoints(task) {
  if (task.assignee) return 1
  const base = SIZE_POINTS[task.size] || 1
  const energyMult = ENERGY_MULTIPLIER[task.energyLevel] || 1.0
  const completedAt = task.completed_at ? new Date(task.completed_at) : new Date()
  const daysOnList = Math.max(0, Math.floor((completedAt.getTime() - new Date(task.created_at).getTime()) / 86400000))
  const speedMultiplier = daysOnList === 0 ? 2 : daysOnList <= 2 ? 1.5 : 1
  return Math.round(base * energyMult * speedMultiplier)
}

// Sum project session points logged today across the entire task list.
// Each project's `session_log` is an array of { timestamp, points }; we
// only count entries whose timestamp lands on today's calendar date.
// Each logged session also counts as a "task" for the daily-task ring so
// chipping at a project shows up in both gauges.
export function computeSessionStatsToday(tasks) {
  const todayStr = new Date().toDateString()
  let count = 0
  let points = 0
  for (const t of tasks) {
    if (t.status !== 'project') continue
    const log = Array.isArray(t.session_log) ? t.session_log : []
    for (const entry of log) {
      if (!entry?.timestamp) continue
      if (new Date(entry.timestamp).toDateString() !== todayStr) continue
      count += 1
      points += entry.points || 0
    }
  }
  return { count, points }
}

// Sum escalation-ladder attempt points logged today, across every task
// (active ladder or not — a resolved/closed ladder's history still counts
// for the day the attempt actually happened). Each logged attempt is worth
// 1 point, same "waiting = progress" principle as elsewhere — sent the
// email, made the call is real effort even without resolution.
export function computeEscalationStatsToday(tasks) {
  const todayStr = new Date().toDateString()
  let count = 0
  let points = 0
  for (const t of tasks) {
    const log = Array.isArray(t.escalation_attempt_log) ? t.escalation_attempt_log : []
    for (const entry of log) {
      if (!entry?.at) continue
      if (new Date(entry.at).toDateString() !== todayStr) continue
      count += 1
      points += entry.points || 0
    }
  }
  return { count, points }
}

// Compute today's task count and total points. Optional `settings` arg
// applies the Easter-egg bonus: winning the hidden tic-tac-toe game
// (triggered by 7-tapping the EditTaskModal title) stamps
// `easter_egg_wins[today] = true` and contributes +1 task + +1 point
// once per day. Tap, fight, win, and you've already done "something
// today" before lifting a finger on the actual list.
//
// Project session logs also contribute — each logged session is +1 task
// and its awarded points roll into the day's total. Lets the daily-progress
// rings reflect "I worked on the basement today" the same as completing
// a one-shot task.
export function computeDailyStats(tasks, settings = null) {
  const now = new Date()
  const todayStr = now.toDateString()
  // Local YMD — UTC variant would flip to "tomorrow" at night Central
  // time and miss easter-egg wins / mismatch other systems that key by
  // local calendar date.
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayTasks = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr)

  let points = 0
  for (const t of todayTasks) {
    points += calculateTaskPoints(t)
    // Stack-clear bonus rides on the task that closed a routine stack cycle.
    // It's stored once, on a task that's done-today, so it counts exactly once.
    points += t.stack_bonus || 0
  }

  const waitingToday = tasks.filter(t => t.status === 'waiting' && t.waiting_at && new Date(t.waiting_at).toDateString() === todayStr)

  const sessions = computeSessionStatsToday(tasks)
  const escalations = computeEscalationStatsToday(tasks)
  const eggBonus = settings?.easter_egg_wins?.[todayIso] ? 1 : 0

  return {
    tasksToday: todayTasks.length + waitingToday.length + sessions.count + escalations.count + eggBonus,
    pointsToday: points + waitingToday.length + sessions.points + escalations.points + eggBonus,
  }
}

// Compute all-time records: best day (tasks & points), longest streak.
export function computeRecords(tasks) {
  const byDay = {}
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      const dayStr = new Date(t.completed_at).toDateString()
      if (!byDay[dayStr]) byDay[dayStr] = { tasks: 0, points: 0 }
      byDay[dayStr].tasks++
      byDay[dayStr].points += calculateTaskPoints(t) + (t.stack_bonus || 0)
    }
  }

  let bestTasks = 0, bestPoints = 0, longestStreak = 0
  for (const day of Object.values(byDay)) {
    if (day.tasks > bestTasks) bestTasks = day.tasks
    if (day.points > bestPoints) bestPoints = day.points
  }

  // Longest streak from sorted dates
  const dates = Object.keys(byDay).map(d => new Date(d)).sort((a, b) => a - b)
  let current = 1
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i - 1]) / 86400000
    if (Math.round(diff) === 1) { current++; if (current > longestStreak) longestStreak = current }
    else { current = 1 }
  }
  if (current > longestStreak) longestStreak = current

  return { bestTasks, bestPoints, longestStreak }
}

// Project session model — kept in sync with server-side db.js constants.
// Per-session credit = budget × SESSION_PCT, capped at SESSION_CAP sessions.
// Budget = max(project's own base, sum of children's base, DEFAULT).
export const PROJECT_SESSION_PCT = 0.10
export const PROJECT_SESSION_CAP = 10
const DEFAULT_PROJECT_BUDGET = 20

function baseTaskPoints(task) {
  const size = SIZE_POINTS[task?.size] || SIZE_POINTS.M
  const energy = ENERGY_MULTIPLIER[task?.energyLevel ?? task?.energy_level] || 1.0
  return size * energy
}

export function computeProjectBudget(project, allTasks = []) {
  if (!project) return DEFAULT_PROJECT_BUDGET
  const own = baseTaskPoints(project)
  const children = allTasks.filter(t => t.parent_id === project.id)
  const childSum = children.reduce((sum, c) => sum + baseTaskPoints(c), 0)
  return Math.max(own, childSum, DEFAULT_PROJECT_BUDGET)
}

export function computeProjectSessionPoints(project, allTasks = []) {
  const budget = computeProjectBudget(project, allTasks)
  return Math.max(1, Math.round(budget * PROJECT_SESSION_PCT))
}

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

export { SIZE_POINTS, ENERGY_MULTIPLIER }
