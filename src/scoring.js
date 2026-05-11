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

// Compute today's task count and total points. Optional `settings` arg
// applies the Easter-egg bonus: winning the hidden tic-tac-toe game
// (triggered by 7-tapping the EditTaskModal title) stamps
// `easter_egg_wins[today] = true` and contributes +1 task + +1 point
// once per day. Tap, fight, win, and you've already done "something
// today" before lifting a finger on the actual list.
export function computeDailyStats(tasks, settings = null) {
  const todayStr = new Date().toDateString()
  const todayIso = new Date().toISOString().split('T')[0]
  const todayTasks = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr)

  let points = 0
  for (const t of todayTasks) {
    points += calculateTaskPoints(t)
  }

  const eggBonus = settings?.easter_egg_wins?.[todayIso] ? 1 : 0

  return {
    tasksToday: todayTasks.length + eggBonus,
    pointsToday: points + eggBonus,
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

export { SIZE_POINTS, ENERGY_MULTIPLIER }
