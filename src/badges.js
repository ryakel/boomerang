// Local, self-derived achievements — NO new data/schema. Everything here is
// computed from data the app already tracks (done tasks, streaks, daily records,
// routine completion history, the analytics daily series). Theme-agnostic: this
// is shared logic surfaced in every skin (Analytics for all, Profile in Wallaby).
//
// Each badge: { id, name, desc, emoji, tier, earned, current, target }.
// `tier` drives display color: bronze | silver | gold.

// Longest run of consecutive calendar days with any completion, from the
// analytics daily series ([{ day:'YYYY-MM-DD', tasks, points }]).
function longestActiveRun(daily) {
  const active = (daily || []).filter(d => (d.tasks || 0) > 0).map(d => d.day).sort()
  if (active.length === 0) return 0
  let best = 1, run = 1
  for (let i = 1; i < active.length; i++) {
    const prev = new Date(active[i - 1] + 'T00:00:00'); prev.setDate(prev.getDate() + 1)
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`
    if (prevKey === active[i]) { run++; best = Math.max(best, run) } else { run = 1 }
  }
  return best
}

// Build the full badge list with earned state + progress. All inputs are
// already computed elsewhere — pass them in (lifetimeDone is a count, history
// is the analytics daily series [{day,tasks,points}]).
export function computeBadges({ lifetimeDone = 0, routines = [], records = {}, streak = 0, history = [] } = {}) {
  const bestStreak = Math.max(streak || 0, records?.longestStreak || 0)
  const bestDayTasks = records?.bestTasks || 0
  const bestDayPoints = records?.bestPoints || 0
  const topHabit = Math.max(0, ...((routines || []).map(r => (r.completed_history?.length || 0))))
  const totalPoints = (history || []).reduce((n, d) => n + (d.points || 0), 0)
  const activeRun = longestActiveRun(history)

  const mk = (id, name, desc, emoji, tier, current, target) =>
    ({ id, name, desc, emoji, tier, current, target, earned: current >= target })

  return [
    mk('first_step', 'First Step', 'Complete your first task', '🌱', 'bronze', lifetimeDone, 1),
    mk('getting_going', 'Getting Going', 'Complete 10 tasks', '🚀', 'bronze', lifetimeDone, 10),
    mk('century', 'Century', 'Complete 100 tasks', '💯', 'silver', lifetimeDone, 100),
    mk('five_hundred', '500 Club', 'Complete 500 tasks', '🏆', 'gold', lifetimeDone, 500),
    mk('week_warrior', 'Week Warrior', '7-day completion streak', '🔥', 'bronze', bestStreak, 7),
    mk('fortnight', 'Fortnight', '14-day completion streak', '⚡', 'silver', bestStreak, 14),
    mk('monthly_master', 'Monthly Master', '30-day completion streak', '👑', 'gold', bestStreak, 30),
    mk('consistent', 'Consistent', 'Active every day for a week', '📅', 'silver', activeRun, 7),
    mk('big_day', 'Big Day', '10 tasks done in one day', '☄️', 'silver', bestDayTasks, 10),
    mk('point_storm', 'Point Storm', '100 points in one day', '⛈️', 'gold', bestDayPoints, 100),
    mk('habit_former', 'Habit Former', 'A habit logged 30 times', '🌿', 'silver', topHabit, 30),
    mk('point_collector', 'Point Collector', 'Earn 1,000 points', '💎', 'gold', totalPoints, 1000),
  ]
}

export function badgeSummary(badges) {
  const earned = badges.filter(b => b.earned).length
  return { earned, total: badges.length }
}
