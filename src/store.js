const TASKS_KEY = 'boom_tasks_v1'
const SETTINGS_KEY = 'boom_settings_v1'
const LABELS_KEY = 'boom_labels_v1'
const ROUTINES_KEY = 'boom_routines_v1'
const MODIFIED_KEY = 'boom_last_modified'

const DEFAULT_SETTINGS = {
  staleness_days: 2,
  reframe_threshold: 3,
  digest_time: '07:00',
  notifications_enabled: false,
  notif_frequency: 30,
  notif_overdue: true,
  notif_stale: true,
  notif_nudge: true,
  default_due_days: 7,
  max_open_tasks: 10,
  stale_warn_days: 7,
  stale_warn_pct: 50,
  custom_instructions: '',
  anthropic_api_key: '',
  notion_token: '',
  notion_parent_page_id: '',
  sort_by: 'age',
  daily_task_goal: 3,
  daily_points_goal: 15,
  vacation_mode: false,
  vacation_started: null,
}

const DEFAULT_LABELS = [
  { id: 'inside', name: 'inside', color: '#4A9EFF' },
  { id: 'outside', name: 'outside', color: '#52C97F' },
  { id: 'follow-up', name: 'follow-up', color: '#FFB347' },
]

const SIZE_ORDER = { XL: 5, L: 4, M: 3, S: 2, XS: 1 }
const SIZE_POINTS = { XS: 1, S: 2, M: 5, L: 10, XL: 20 }

const LABEL_COLORS = [
  '#4A9EFF', '#52C97F', '#FFB347', '#FF6240', '#A78BFA',
  '#F472B6', '#34D399', '#FBBF24', '#60A5FA', '#FB923C',
]

const RECURRENCE_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
  { value: 'custom', label: 'Custom' },
]

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

// Touch the local modification timestamp — used by useSync to detect
// whether localStorage is newer than the server on hydration.
function touchModified() {
  localStorage.setItem(MODIFIED_KEY, String(Date.now()))
}

export function getLocalModified() {
  return parseInt(localStorage.getItem(MODIFIED_KEY) || '0', 10)
}

export function setLocalModified(ts) {
  localStorage.setItem(MODIFIED_KEY, String(ts))
}

export function loadTasks() {
  const tasks = load(TASKS_KEY, [])
  const doneCount = tasks.filter(t => t.status === 'done').length
  console.log(`[STORE] loadTasks → ${tasks.length} tasks (${doneCount} done)`)
  return tasks
}
export function saveTasks(tasks) {
  const doneCount = tasks.filter(t => t.status === 'done').length
  console.log(`[STORE] saveTasks ← ${tasks.length} tasks (${doneCount} done)`, new Error().stack?.split('\n')[2]?.trim())
  save(TASKS_KEY, tasks); touchModified()
}
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) } }
export function saveSettings(settings) {
  console.log('[STORE] saveSettings')
  save(SETTINGS_KEY, settings); touchModified()
}
export function loadLabels() {
  const labels = load(LABELS_KEY, DEFAULT_LABELS)
  console.log(`[STORE] loadLabels → ${labels.length} labels: [${labels.map(l => l.name).join(', ')}]`)
  return labels
}
export function saveLabels(labels) {
  console.log(`[STORE] saveLabels ← ${labels.length} labels: [${labels.map(l => l.name).join(', ')}]`, new Error().stack?.split('\n')[2]?.trim())
  save(LABELS_KEY, labels); touchModified()
}
export function loadRoutines() { return load(ROUTINES_KEY, []) }
export function saveRoutines(routines) {
  console.log(`[STORE] saveRoutines ← ${routines.length} routines`)
  save(ROUTINES_KEY, routines); touchModified()
}

export function createTask(title, tags = [], dueDate = null, notes = '') {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title,
    status: 'open',
    tags,
    notes,
    due_date: dueDate,
    snoozed_until: null,
    snooze_count: 0,
    staleness_days: loadSettings().staleness_days,
    last_touched: now,
    created_at: now,
    completed_at: null,
    reframe_notes: null,
    notion_page_id: null,
    notion_url: null,
    routine_id: null,
    size: null,
    attachments: [],
  }
}

export function createRoutine(title, cadence, customDays = null, tags = [], notes = '') {
  return {
    id: crypto.randomUUID(),
    title,
    cadence, // daily, weekly, monthly, quarterly, annually, custom
    custom_days: customDays, // for 'custom': number of days between
    tags,
    notes,
    notion_page_id: null,
    notion_url: null,
    created_at: new Date().toISOString(),
    completed_history: [], // array of ISO date strings
    paused: false,
  }
}

export function getNextDueDate(routine) {
  const lastDone = routine.completed_history.length > 0
    ? new Date(routine.completed_history[routine.completed_history.length - 1])
    : new Date(routine.created_at)

  const next = new Date(lastDone)
  switch (routine.cadence) {
    case 'daily': next.setDate(next.getDate() + 1); break
    case 'weekly': next.setDate(next.getDate() + 7); break
    case 'monthly': next.setMonth(next.getMonth() + 1); break
    case 'quarterly': next.setMonth(next.getMonth() + 3); break
    case 'annually': next.setFullYear(next.getFullYear() + 1); break
    case 'custom': next.setDate(next.getDate() + (routine.custom_days || 7)); break
  }
  return next
}

export function isRoutineDue(routine) {
  if (routine.paused) return false
  const nextDue = getNextDueDate(routine)
  return Date.now() >= nextDue.getTime()
}

export function formatCadence(routine) {
  if (routine.cadence === 'custom') return `every ${routine.custom_days}d`
  return routine.cadence
}

export function isStale(task) {
  if (task.status !== 'open') return false
  if (task.snoozed_until && new Date(task.snoozed_until) > new Date()) return false
  const elapsed = Date.now() - new Date(task.last_touched).getTime()
  return elapsed > task.staleness_days * 86400000
}

export function isSnoozed(task) {
  return task.snoozed_until != null && new Date(task.snoozed_until) > new Date()
}

export function isOverdue(task) {
  if (!task.due_date || task.status !== 'open') return false
  const due = parseDateLocal(task.due_date)
  due.setHours(23, 59, 59, 999)
  return Date.now() > due.getTime()
}

function parseDateLocal(dateStr) {
  // "2026-03-30" → local midnight, not UTC
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDueDate(dateStr) {
  const due = parseDateLocal(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((due - today) / 86400000)

  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
  if (diffDays === 0) return 'due today'
  if (diffDays === 1) return 'due tomorrow'
  if (diffDays <= 7) return `due in ${diffDays}d`
  return `due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export function getSnoozeOptions() {
  const now = new Date()
  const hour = now.getHours()

  const tonight = new Date(now)
  if (hour >= 19) { tonight.setTime(now.getTime() + 4 * 3600000) }
  else { tonight.setHours(20, 0, 0, 0) }

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)

  const saturday = new Date(now)
  const dayOfWeek = now.getDay()
  const daysUntilSat = dayOfWeek === 6 ? 7 : (6 - dayOfWeek)
  saturday.setDate(saturday.getDate() + daysUntilSat)
  saturday.setHours(10, 0, 0, 0)

  const monday = new Date(now)
  const daysUntilMon = dayOfWeek === 1 ? 7 : ((8 - dayOfWeek) % 7)
  monday.setDate(monday.getDate() + daysUntilMon)
  monday.setHours(9, 0, 0, 0)

  return [
    { label: 'Tonight', date: tonight },
    { label: 'Tomorrow', date: tomorrow },
    { label: 'This Weekend', date: saturday },
    { label: 'Next Week', date: monday },
  ]
}

export function formatSnoozeLabel(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffHours = diffMs / 3600000
  if (diffHours < 24) return 'tonight'
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return 'tomorrow'
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function daysOld(task) {
  const elapsed = Date.now() - new Date(task.last_touched).getTime()
  return Math.floor(elapsed / 86400000)
}

export function getDefaultDueDate() {
  const settings = loadSettings()
  const days = settings.default_due_days
  if (!days || days <= 0) return ''
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

export function sortTasks(list, sortBy) {
  const sorted = [...list]
  switch (sortBy) {
    case 'due_date':
      sorted.sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      })
      break
    case 'size':
      sorted.sort((a, b) => {
        const aVal = SIZE_ORDER[a.size] || 0
        const bVal = SIZE_ORDER[b.size] || 0
        return bVal - aVal
      })
      break
    case 'name':
      sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
      break
    case 'age':
    default:
      sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      break
  }
  return sorted
}

export function computeDailyStats(tasks) {
  const todayStr = new Date().toDateString()
  const todayTasks = tasks.filter(t => t.status === 'done' && t.completed_at && new Date(t.completed_at).toDateString() === todayStr)

  let points = 0
  for (const t of todayTasks) {
    const base = SIZE_POINTS[t.size] || 1
    const daysOnList = Math.max(0, Math.floor((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 86400000))
    const speedMultiplier = daysOnList === 0 ? 2 : daysOnList <= 2 ? 1.5 : 1
    points += Math.round(base * speedMultiplier)
  }

  return { tasksToday: todayTasks.length, pointsToday: points }
}

export function computeStreak(tasks, settings) {
  if (settings.vacation_mode) return settings.streak_current || 0

  // Count consecutive days with at least 1 completion, working backward from today
  const completionDates = new Set()
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      completionDates.add(new Date(t.completed_at).toDateString())
    }
  }

  let streak = 0
  const d = new Date()
  // Check today first - if nothing done today, check if yesterday had completions
  if (!completionDates.has(d.toDateString())) {
    d.setDate(d.getDate() - 1)
    if (!completionDates.has(d.toDateString())) return 0
  }

  while (completionDates.has(d.toDateString())) {
    streak++
    d.setDate(d.getDate() - 1)
  }

  return streak
}

export function computeRecords(tasks) {
  const byDay = {}
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      const dayStr = new Date(t.completed_at).toDateString()
      if (!byDay[dayStr]) byDay[dayStr] = { tasks: 0, points: 0 }
      byDay[dayStr].tasks++
      const base = SIZE_POINTS[t.size] || 1
      const daysOnList = Math.max(0, Math.floor((new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 86400000))
      const speedMultiplier = daysOnList === 0 ? 2 : daysOnList <= 2 ? 1.5 : 1
      byDay[dayStr].points += Math.round(base * speedMultiplier)
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

export function computeTaskPoints(task) {
  const base = SIZE_POINTS[task.size] || 1
  const completedAt = task.completed_at ? new Date(task.completed_at) : new Date()
  const daysOnList = Math.max(0, Math.floor((completedAt.getTime() - new Date(task.created_at).getTime()) / 86400000))
  const speedMultiplier = daysOnList === 0 ? 2 : daysOnList <= 2 ? 1.5 : 1
  return Math.round(base * speedMultiplier)
}

export { LABEL_COLORS, RECURRENCE_OPTIONS, SIZE_POINTS }
