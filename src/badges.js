// Local, self-derived achievements surfaced in every skin (Analytics for all,
// Profile in Wallaby). Progress is computed live from data the app already
// tracks — but EARNED STATE IS DURABLE: the first time a badge computes as
// earned, its id + date are stamped into settings.badges_earned (key-union
// guarded server-side), so deleting the underlying rows can never un-earn an
// achievement. See Derived-Stat Durability Rules in CLAUDE.md.
//
// Each badge: { id, name, desc, emoji, tier, earned, earnedOn?, current,
// target, hidden? }. `tier` drives display color: bronze | silver | gold.
// `hidden` badges render as mystery cards until earned.

import { loadSettings, saveSettings, localYMD, parseLocalDate } from './store'

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

const ENERGY_TYPE_COUNT = 6 // desk, people, errand, confrontation, creative, physical

// Per-day buckets of completed tasks (local days), reused by several badges.
function completionsByDay(doneTasks) {
  const map = {}
  for (const t of doneTasks) {
    const key = localYMD(new Date(t.completed_at))
    if (!map[key]) map[key] = []
    map[key].push(t)
  }
  return map
}

// Build the full badge list with earned state + progress. `tasks` powers the
// task-shaped badges; surfaces without the task list (Wallaby Profile) still
// show durable earned state from settings.badges_earned.
export function computeBadges({ lifetimeDone = 0, routines = [], records = {}, streak = 0, history = [], tasks = [] } = {}) {
  const bestStreak = Math.max(streak || 0, records?.longestStreak || 0)
  const bestDayTasks = records?.bestTasks || 0
  const bestDayPoints = records?.bestPoints || 0
  const topHabit = Math.max(0, ...((routines || []).map(r => (r.completed_history?.length || 0))))
  const totalPoints = (history || []).reduce((n, d) => n + (d.points || 0), 0)
  const activeRun = longestActiveRun(history)

  const done = (tasks || []).filter(t => t.status === 'done' && t.completed_at)
  const byDay = completionsByDay(done)
  const days = Object.values(byDay)

  // Recovery + honesty + pattern signals
  const cameBack = done.filter(t => t.created_at
    && (new Date(t.completed_at) - new Date(t.created_at)) >= 30 * 86400000).length
  const dragonsSlain = done.filter(t => t.energy === 'confrontation' && t.energyLevel === 3).length
  const dawnBest = Math.max(0, ...days.map(d =>
    d.filter(t => new Date(t.completed_at).getHours() < 8).length))
  const nightCatches = done.filter(t => new Date(t.completed_at).getHours() >= 22).length
  const heavyBest = Math.max(0, ...days.map(d =>
    d.filter(t => t.size === 'L' || t.size === 'XL').length))
  const stackBonuses = done.filter(t => (t.stack_bonus || 0) > 0).length
  const setAside = (tasks || []).filter(t => t.snooze_indefinite).length

  // Best Sat+Sun weekend total.
  let weekendBest = 0
  for (const [key, list] of Object.entries(byDay)) {
    const d = new Date(key + 'T12:00:00')
    if (d.getDay() !== 6) continue // anchor on Saturdays
    const sun = new Date(d); sun.setDate(sun.getDate() + 1)
    const sunKey = localYMD(sun)
    weekendBest = Math.max(weekendBest, list.length + (byDay[sunKey]?.length || 0))
  }

  // Most distinct energy types caught within a single Mon-Sun week.
  const weekTypes = {}
  for (const t of done) {
    if (!t.energy) continue
    const d = new Date(t.completed_at); d.setHours(0, 0, 0, 0)
    const diff = (d.getDay() + 6) % 7 // Monday-anchored
    d.setDate(d.getDate() - diff)
    const wk = localYMD(d)
    if (!weekTypes[wk]) weekTypes[wk] = new Set()
    weekTypes[wk].add(t.energy)
  }
  const balancedBest = Math.max(0, ...Object.values(weekTypes).map(s => s.size))

  // A quarterly+ loop kept alive for a year (history span).
  let longHaulDays = 0
  for (const r of routines || []) {
    if (!['quarterly', 'annually'].includes(r.cadence)) continue
    const hist = (r.completed_history || []).map(ts => new Date(ts).getTime()).filter(Number.isFinite)
    if (hist.length < 2) continue
    longHaulDays = Math.max(longHaulDays, Math.round((Math.max(...hist) - Math.min(...hist)) / 86400000))
  }

  // Clean Sweep: today you caught 3+ tasks that were overdue, and nothing
  // overdue remains. Computed from live state — the durable earn stamp
  // makes the moment permanent once it happens.
  const todayKey = localYMD()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const overdueCaughtToday = done.filter(t =>
    localYMD(new Date(t.completed_at)) === todayKey
    && t.due_date && parseLocalDate(String(t.due_date).slice(0, 10)) < todayStart).length
  const overdueRemaining = (tasks || []).filter(t =>
    ['not_started', 'doing', 'in_progress', 'waiting'].includes(t.status)
    && t.due_date && parseLocalDate(String(t.due_date).slice(0, 10)) < todayStart).length
  const cleanSweep = overdueCaughtToday >= 3 && overdueRemaining === 0 ? 1 : 0

  // Phoenix: you lost a 14+ day rally and built a new 7+ day one from the
  // ashes. Only detectable while the new rally is shorter than the old best;
  // the durable earn stamp makes the moment permanent.
  const phoenix = (records?.longestStreak || 0) >= 14 && streak >= 7 && streak < records.longestStreak ? 1 : 0

  const mk = (id, name, desc, emoji, tier, current, target, hidden = false) =>
    ({ id, name, desc, emoji, tier, current, target, earned: current >= target, hidden })

  const badges = [
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
    // Recovery class — the Boomerang signature set.
    mk('it_comes_back', 'It Comes Back', 'Catch a task 30+ days old', '🪃', 'silver', cameBack, 1, true),
    mk('phoenix', 'Phoenix', 'Lose a 14+ day rally, then build a 7-day one from the ashes', '🔆', 'gold', phoenix, 1, true),
    mk('strategic_retreat', 'Strategic Retreat', 'Set aside 5 tasks — knowing your limits is a skill', '🏳️', 'bronze', setAside, 5),
    mk('clean_sweep', 'Clean Sweep', 'Catch 3+ overdue tasks and end the day with zero overdue', '🧹', 'gold', cleanSweep, 1),
    // Energy class.
    mk('dragon_slayer', 'Dragon Slayer', 'Catch a ⚡⚡⚡ confrontation task', '🐉', 'silver', dragonsSlain, 1),
    mk('balanced_diet', 'Balanced Diet', 'Catch every energy type in one week', '🥗', 'gold', balancedBest, ENERGY_TYPE_COUNT),
    mk('heavy_lifting', 'Heavy Lifting', '3 L or XL tasks in one day', '🏋️', 'silver', heavyBest, 3),
    // Time-of-day / pattern class.
    mk('dawn_patrol', 'Dawn Patrol', '3 catches before 8am in one day', '🌅', 'bronze', dawnBest, 3),
    mk('night_shift', 'Night Shift', 'A catch after 10pm', '🌙', 'bronze', nightCatches, 1, true),
    mk('weekend_warrior', 'Weekend Warrior', '10 catches in one weekend', '🛠️', 'silver', weekendBest, 10),
    // Loop class.
    mk('stack_champion', 'Stack Champion', 'Earn 10 stack clear-bonuses', '📦', 'silver', stackBonuses, 10),
    mk('long_haul', 'Long Haul', 'Keep a quarterly+ loop alive for a year', '🛤️', 'gold', longHaulDays, 365),
  ]

  // Durable earned state: once stamped, a badge stays earned no matter what
  // happens to the rows that earned it.
  const earnedMap = loadSettings()?.badges_earned || {}
  for (const b of badges) {
    if (earnedMap[b.id]) {
      b.earned = true
      b.earnedOn = earnedMap[b.id]
      b.current = Math.max(b.current, b.target)
    }
  }
  return badges
}

// Stamp newly-earned badges into durable settings. Called by BadgesGrid on
// render (the single shared surface) — returns the freshly earned list so a
// caller could celebrate. saveSettings flows to the server via the normal
// settings sync; the server key-union guard protects it from stale blobs.
export function stampEarnedBadges(badges) {
  const fresh = badges.filter(b => b.earned && !b.earnedOn)
  if (fresh.length === 0) return []
  const cur = loadSettings()
  const map = { ...(cur.badges_earned || {}) }
  const today = localYMD()
  for (const b of fresh) { if (!map[b.id]) map[b.id] = today }
  saveSettings({ ...cur, badges_earned: map })
  return fresh
}

export function badgeSummary(badges) {
  const earned = badges.filter(b => b.earned).length
  return { earned, total: badges.length }
}
