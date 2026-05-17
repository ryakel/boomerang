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
export function calculateTaskPoints(task) {
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
  const todayStr = new Date().toDateString()
  const todayIso = new Date().toISOString().split('T')[0]
  const todayTasks = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr)

  let points = 0
  for (const t of todayTasks) {
    points += calculateTaskPoints(t)
  }

  const sessions = computeSessionStatsToday(tasks)
  const eggBonus = settings?.easter_egg_wins?.[todayIso] ? 1 : 0

  return {
    tasksToday: todayTasks.length + sessions.count + eggBonus,
    pointsToday: points + sessions.points + eggBonus,
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
      byDay[dayStr].points += calculateTaskPoints(t)
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

export { SIZE_POINTS, ENERGY_MULTIPLIER }
