// crypto.randomUUID is unavailable over plain HTTP (non-secure context)
export const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

const TASKS_KEY = 'boom_tasks_v1'
const SETTINGS_KEY = 'boom_settings_v1'
const LABELS_KEY = 'boom_labels_v1'
const ROUTINES_KEY = 'boom_routines_v1'
const MODIFIED_KEY = 'boom_last_modified'
const ACTIVITY_LOG_KEY = 'boom_activity_log_v1'

export const DEFAULT_SETTINGS = {
  staleness_days: 2,
  reframe_threshold: 3,
  digest_time: '07:00',
  user_timezone: '', // auto-detected from browser on first load via Intl API
  notifications_enabled: false,
  notif_overdue: true,
  notif_stale: true,
  notif_nudge: true,
  notif_freq_overdue: 0.5,
  notif_freq_stale: 0.5,
  notif_freq_nudge: 1,
  notif_freq_size: 1,
  notif_freq_pileup: 2,
  notif_freq_highpri_before: 24,
  notif_freq_highpri_due: 1,
  notif_freq_highpri_overdue: 0.5,
  notif_highpri_escalate: true,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  default_due_days: 7,
  max_open_tasks: 10,
  stale_warn_days: 7,
  stale_warn_pct: 50,
  custom_instructions: '',
  anthropic_api_key: '',
  notion_token: '',
  notion_parent_page_id: '',
  notion_sync_parent_id: '',   // parent page whose children become tasks
  notion_sync_parent_title: '', // display name for the sync parent
  notion_last_sync: null,
  sort_by: 'age',
  daily_task_goal: 3,
  daily_points_goal: 15,
  // 7-day calendar strip above the task sections. Opt-in in light/dark,
  // auto-on in terminal mode. Today's cell shows N/goal inline + intensity
  // fill; this is the single source of truth for daily-goal progress
  // (GoalProgressBar was removed 2026-05-11).
  show_week_strip: false,
  vacation_mode: false,
  vacation_started: null,
  trello_api_key: '',
  trello_secret: '',
  trello_board_id: '',
  trello_board_name: '',
  trello_list_id: '',
  trello_list_name: '',
  trello_list_mapping: null,
  trello_last_sync: null,
  gcal_client_id: '',
  gcal_client_secret: '',
  gcal_calendar_id: 'primary',
  gcal_sync_enabled: false,
  gcal_sync_statuses: ['not_started', 'doing', 'waiting', 'open'],
  gcal_use_timed_events: true,
  gcal_default_time: '09:00',
  gcal_event_duration: 60,
  gcal_remove_on_complete: true,
  gcal_pull_enabled: false,
  gcal_event_buffer: false,
  gcal_last_sync: null,
  gmail_sync_enabled: false,
  gmail_scan_days: 7,
  gmail_last_sync: null,
  usps_client_id: '',
  usps_client_secret: '',
  usps_mid: '',
  tracking_api_key: '',
  package_retention_days: 3,
  package_notify_delivered: true,
  package_notify_exception: true,
  package_notify_signature: true,
  package_auto_task_signature: true,
  email_notifications_enabled: false,
  email_address: '',
  // From-address overrides (for deliverability — use a domain you control with
  // SPF/DKIM/DMARC configured on your SMTP relay).
  email_from_address: '',
  email_from_name: 'Boomerang Digest',
  email_notif_overdue: true,
  email_notif_stale: true,
  email_notif_nudge: true,
  email_notif_highpri: true,
  email_notif_size: true,
  email_notif_pileup: true,
  email_notif_package_delivered: true,
  email_notif_package_exception: true,
  // Public app URL (for deep links in notifications). Empty = relative links;
  // Pushover sends only get clickable URLs when this is set.
  public_app_url: '',
  // Digest content style: 'curated' (positive recap + sectioned tasks) or
  // 'counts' (legacy plain count summary)
  digest_style: 'curated',
  pushover_digest_enabled: false,
  // Name of the label that grants quiet-hours bypass for Pushover priority 1+2.
  // Default: 'wake-me'. Tasks tagged with this label can wake the user up;
  // every other task is silent during quiet hours regardless of priority.
  quiet_hours_bypass_label: 'wake-me',
  // Pushover (gated by credentials being entered in Settings)
  pushover_notifications_enabled: false,
  pushover_user_key: '',
  pushover_app_token: '',
  pushover_notif_highpri: true,
  pushover_notif_overdue: true,
  pushover_notif_stale: false,
  pushover_notif_nudge: false,
  pushover_notif_size: false,
  pushover_notif_pileup: true,
  pushover_notif_package_delivered: true,
  pushover_notif_package_exception: true,
  notion_page_template: `## Overview\n> Context and background for this task\n\n### Details\n- **Last Updated:** {last_updated}\n- **Frequency:** {frequency}\n- **Last Performed:** {last_performed}\n\n## Notes\n- Key details from task notes\n\n## Action Items\n- [ ] First step\n- [ ] Second step\n- [ ] Third step\n\n---\n\n## Reference\n- Related links or resources\n\n## Tags\n- {tags}`,
}

const DEFAULT_LABELS = [
  { id: 'inside', name: 'inside', color: '#4A9EFF' },
  { id: 'outside', name: 'outside', color: '#52C97F' },
  { id: 'follow-up', name: 'follow-up', color: '#FFB347' },
  // Quiet-hours bypass label — tasks with this label can fire priority-1 / priority-2
  // notifications during quiet hours. Default to red as visual flag.
  { id: 'wake-me', name: 'wake-me', color: '#FF6240' },
]

const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting']

const STATUS_META = {
  not_started: { label: 'Not Started', color: 'var(--text-dim)' },
  doing: { label: 'Doing', color: '#4A9EFF' },
  waiting: { label: 'Waiting', color: '#FFB347' },
  done: { label: 'Done', color: '#52C97F' },
  project: { label: 'Project', color: '#A78BFA' },
}

function isActiveTask(task) {
  return ACTIVE_STATUSES.includes(task.status) || task.status === 'open'
}

const SIZE_ORDER = { XL: 5, L: 4, M: 3, S: 2, XS: 1 }

// Energy/capacity types — what kind of effort a task demands
const ENERGY_TYPES = [
  { id: 'desk', label: 'Desk', icon: 'Monitor', color: '#60A5FA' },
  { id: 'people', label: 'People', icon: 'Users', color: '#A78BFA' },
  { id: 'errand', label: 'Errand', icon: 'MapPin', color: '#34D399' },
  { id: 'creative', label: 'Creative', icon: 'Palette', color: '#F472B6' },
  { id: 'physical', label: 'Physical', icon: 'Dumbbell', color: '#FBBF24' },
]

// Energy types that get more aggressive nagging (ADHD avoidance-prone)
const AVOIDANCE_ENERGY_TYPES = ['errand']

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

// Touch the local modification timestamp — used to detect
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

export function loadTasks() { return load(TASKS_KEY, []) }
export function saveTasks(tasks) { save(TASKS_KEY, tasks); touchModified() }
export function loadSettings() {
  const saved = load(SETTINGS_KEY, {})
  // Migrate old minute-based frequency values to hours (one-time)
  if (!saved._freq_migrated) {
    const freqKeys = ['notif_freq_overdue', 'notif_freq_stale', 'notif_freq_nudge', 'notif_freq_size', 'notif_freq_pileup']
    let migrated = false
    for (const key of freqKeys) {
      if (saved[key] != null && saved[key] > 10) {
        saved[key] = Math.round((saved[key] / 60) * 100) / 100 // minutes → hours
        migrated = true
      }
    }
    if (migrated || Object.keys(saved).length > 0) {
      saved._freq_migrated = true
      save(SETTINGS_KEY, saved)
    }
  }
  // Remove legacy notif_frequency field
  delete saved.notif_frequency
  // Theme palette family migration (2026-05-10): the original 'terminal'
  // theme value is now the GitHub Dark sub-palette. terminal-light joined
  // as a peer. Old value silently upgrades to terminal-dark; saved back so
  // the next read short-circuits.
  if (saved.theme === 'terminal') {
    saved.theme = 'terminal-dark'
    save(SETTINGS_KEY, saved)
  }
  return { ...DEFAULT_SETTINGS, ...saved }
}
export function saveSettings(settings) { save(SETTINGS_KEY, settings); touchModified() }
export function loadLabels() { return load(LABELS_KEY, DEFAULT_LABELS) }
export function saveLabels(labels) { save(LABELS_KEY, labels); touchModified() }
export function loadRoutines() { return load(ROUTINES_KEY, []) }
export function saveRoutines(routines) { save(ROUTINES_KEY, routines); touchModified() }

export function createTask(title, tags = [], dueDate = null, notes = '') {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    title,
    status: 'not_started',
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
    trello_card_id: null,
    trello_card_url: null,
    gcal_event_id: null,
    gcal_duration: null,   // per-task duration override in minutes (null = use AI/size default)
    routine_id: null,
    high_priority: false,
    low_priority: false,
    size: 'M',           // default to M so points always compute; background auto-sizer will refine
    size_inferred: false, // set true after successful inferSize or manual user pick
    energy: null,        // energy type: desk|people|errand|confrontation|creative|physical
    energyLevel: null,   // drain intensity: 1 (low), 2 (medium), 3 (high)
    attachments: [],
    checklists: [],      // [{ id, name, items: [{ id, text, completed }], hideCompleted }]
    comments: [],
  }
}

export function createRoutine(title, cadence, customDays = null, tags = [], notes = '') {
  return {
    id: uuid(),
    title,
    cadence, // daily, weekly, monthly, quarterly, annually, custom
    custom_days: customDays, // for 'custom': number of days between
    schedule_day_of_week: null, // optional weekday anchor (0=Sun … 6=Sat). When
                                // set, next-due snaps forward to this weekday.
    tags,
    notes,
    high_priority: false,
    energy: null,        // energy type: desk|people|errand|confrontation|creative|physical
    energyLevel: null,   // drain intensity: 1 (low), 2 (medium), 3 (high)
    notion_page_id: null,
    notion_url: null,
    created_at: new Date().toISOString(),
    completed_history: [], // array of ISO date strings
    paused: false,
    end_date: null,      // optional YYYY-MM-DD — routine auto-pauses after this date
    gcal_recurring_event_id: null, // Google Calendar recurring event ID
  }
}

// Snap `date` forward to the first occurrence of `weekday` (0=Sun … 6=Sat) on
// or after itself. If already on that weekday, returns `date` unchanged.
function snapToWeekday(date, weekday) {
  const current = date.getDay()
  const delta = (weekday - current + 7) % 7
  if (delta === 0) return date
  const next = new Date(date)
  next.setDate(next.getDate() + delta)
  return next
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

  // If a weekday anchor is set, snap forward to the next matching weekday
  // (may drift up to 6 days from the cadence interval for non-weekly). 'daily'
  // is ignored since it fires every day anyway.
  const dow = routine.schedule_day_of_week
  if (dow != null && routine.cadence !== 'daily') {
    return snapToWeekday(next, dow)
  }
  return next
}

export function isRoutineDue(routine) {
  if (routine.paused) return false
  if (routine.end_date) {
    const endOfDay = new Date(routine.end_date + 'T23:59:59')
    if (Date.now() > endOfDay.getTime()) return false
  }
  const nextDue = getNextDueDate(routine)
  return Date.now() >= nextDue.getTime()
}

export function formatCadence(routine) {
  if (routine.cadence === 'custom') return `every ${routine.custom_days}d`
  return routine.cadence
}

export function isStale(task) {
  if (!isActiveTask(task)) return false
  if (task.snoozed_until && new Date(task.snoozed_until) > new Date()) return false
  const elapsed = Date.now() - new Date(task.last_touched).getTime()
  return elapsed > task.staleness_days * 86400000
}

export function isSnoozed(task) {
  return task.snoozed_until != null && new Date(task.snoozed_until) > new Date()
}

export function isOverdue(task) {
  if (!task.due_date || !isActiveTask(task)) return false
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

// Scoring functions moved to src/scoring.js:
// computeDailyStats, computeRecords, computeTaskPoints, calculateTaskPoints
// Re-exported below for backward compatibility.

export function computeStreak(tasks, settings) {
  if (settings.vacation_mode) {
    // Auto-expire vacation if end date has passed
    if (settings.vacation_end && new Date() >= new Date(settings.vacation_end)) {
      // Expired — treat vacation days as free days for streak calculation below
    } else {
      return settings.streak_current || 0
    }
  }

  const freeDays = new Set(settings.free_days || [])

  // Count consecutive days with at least 1 completion (or a free day), working backward from today
  const completionDates = new Set()
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      completionDates.add(new Date(t.completed_at).toDateString())
    }
  }

  let streak = 0
  const d = new Date()
  // Check today first - if nothing done today and not a free day, check yesterday
  if (!completionDates.has(d.toDateString()) && !freeDays.has(d.toISOString().split('T')[0])) {
    d.setDate(d.getDate() - 1)
    if (!completionDates.has(d.toDateString()) && !freeDays.has(d.toISOString().split('T')[0])) return 0
  }

  while (completionDates.has(d.toDateString()) || freeDays.has(d.toISOString().split('T')[0])) {
    streak++
    d.setDate(d.getDate() - 1)
  }

  return streak
}

// Per-routine streak — counts consecutive cadence cycles completed without
// a miss, walking back from the most recent completion. A "miss" is a gap
// between two consecutive `completed_history` entries that exceeds 1.5×
// the cadence interval. Returns 0 if the routine has never been completed.
//
// Used by TaskCard to render a small `🔥N` indicator next to routine-spawned
// tasks in terminal mode (PR G density). Per-routine, not per-task — every
// task spawned by routine X shares the same routine streak number.
export function computeRoutineStreak(routine) {
  const history = routine?.completed_history || []
  if (history.length === 0) return 0
  if (history.length === 1) return 1

  const tolerance = cadenceIntervalMs(routine.cadence, routine.custom_days) * 1.5
  let streak = 1
  for (let i = history.length - 1; i > 0; i--) {
    const a = new Date(history[i]).getTime()
    const b = new Date(history[i - 1]).getTime()
    if (a - b <= tolerance) streak++
    else break
  }
  return streak
}

function cadenceIntervalMs(cadence, customDays) {
  const day = 24 * 60 * 60 * 1000
  switch (cadence) {
    case 'daily': return day
    case 'weekly': return 7 * day
    case 'monthly': return 30 * day
    case 'quarterly': return 91 * day
    case 'annually': return 365 * day
    case 'custom': return (customDays || 1) * day
    default: return day
  }
}

// Activity log — tracks task lifecycle events for recovery
const MAX_ACTIVITY_LOG = 500

export function loadActivityLog() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || '[]')
  } catch { return [] }
}

export function saveActivityLog(log) {
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(log))
}

export function logActivity(action, task) {
  const log = loadActivityLog()
  log.unshift({
    id: uuid(),
    action, // 'created' | 'completed' | 'deleted' | 'status_changed' | 'edited' | 'snoozed' | 'priority_changed'
    task_id: task.id,
    task_title: task.title,
    task_snapshot: { ...task },
    timestamp: new Date().toISOString(),
  })
  // Keep log bounded
  if (log.length > MAX_ACTIVITY_LOG) log.length = MAX_ACTIVITY_LOG
  saveActivityLog(log)
}

const NOTIF_LOG_KEY = 'boom_notif_log_v1'
const MAX_NOTIF_LOG = 200

export function loadNotifLog() {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_LOG_KEY) || '[]')
  } catch { return [] }
}

export function saveNotifLog(log) {
  localStorage.setItem(NOTIF_LOG_KEY, JSON.stringify(log))
}

export function logNotification(type, title, body) {
  const log = loadNotifLog()
  log.unshift({
    id: uuid(),
    type,
    title,
    body,
    timestamp: new Date().toISOString(),
  })
  if (log.length > MAX_NOTIF_LOG) log.length = MAX_NOTIF_LOG
  saveNotifLog(log)
}

export function clearNotifLog() {
  localStorage.removeItem(NOTIF_LOG_KEY)
}

// Format a time for snooze display: "8 PM" or "9 AM"
function fmtTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
}

// Format a day for snooze display: "Mon Apr 7"
function fmtDay(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Deduplicate snooze options that land on the same calendar day
function dedup(options) {
  const seen = new Set()
  return options.filter(opt => {
    const key = opt.date.toDateString()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function getSnoozeOptions() {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay() // 0=Sun, 6=Sat

  const options = []

  // "Tonight" — only if before 7 PM (otherwise it's already tonight)
  if (hour < 19) {
    const tonight = new Date(now)
    tonight.setHours(20, 0, 0, 0)
    options.push({ label: `Tonight · ${fmtTime(tonight)}`, date: tonight })
  }

  // "Tomorrow morning"
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  options.push({ label: `Tomorrow · ${fmtDay(tomorrow)} ${fmtTime(tomorrow)}`, date: tomorrow })

  // "This Weekend" — only Mon–Thu (Fri–Sun it's already the weekend or tomorrow is)
  if (day >= 1 && day <= 4) {
    const saturday = new Date(now)
    saturday.setDate(saturday.getDate() + (6 - day))
    saturday.setHours(10, 0, 0, 0)
    options.push({ label: `This Weekend · ${fmtDay(saturday)} ${fmtTime(saturday)}`, date: saturday })
  }

  // "Next Week" — next Monday, but only if that's 2+ days away
  const monday = new Date(now)
  const daysUntilMon = day === 0 ? 1 : (8 - day)
  monday.setDate(monday.getDate() + daysUntilMon)
  monday.setHours(9, 0, 0, 0)
  options.push({ label: `Next Week · ${fmtDay(monday)} ${fmtTime(monday)}`, date: monday })

  // "In 3 Days" — filler if we ended up with few options
  if (options.length < 4) {
    const inThree = new Date(now)
    inThree.setDate(inThree.getDate() + 3)
    inThree.setHours(9, 0, 0, 0)
    options.push({ label: `In 3 Days · ${fmtDay(inThree)} ${fmtTime(inThree)}`, date: inThree })
  }

  return dedup(options)
}

export function getSnoozeOptionsShort() {
  const now = new Date()
  const hour = now.getHours()

  const options = []

  // "2 Hours"
  const later = new Date(now.getTime() + 2 * 3600000)
  options.push({ label: `2 Hours · ${fmtTime(later)}`, date: later })

  // "Tonight" — only if before 7 PM
  if (hour < 19) {
    const tonight = new Date(now)
    tonight.setHours(20, 0, 0, 0)
    options.push({ label: `Tonight · ${fmtTime(tonight)}`, date: tonight })
  }

  // "Tomorrow morning"
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  options.push({ label: `Tomorrow · ${fmtDay(tomorrow)} ${fmtTime(tomorrow)}`, date: tomorrow })

  // "Day After Tomorrow"
  const dayAfter = new Date(now)
  dayAfter.setDate(dayAfter.getDate() + 2)
  dayAfter.setHours(9, 0, 0, 0)
  options.push({ label: `${fmtDay(dayAfter)} · ${fmtTime(dayAfter)}`, date: dayAfter })

  return dedup(options)
}

// Re-export scoring functions so existing imports from store.js keep working
export { computeDailyStats, computeRecords, calculateTaskPoints as computeTaskPoints, SIZE_POINTS, ENERGY_MULTIPLIER } from './scoring.js'

export { ACTIVE_STATUSES, STATUS_META, isActiveTask, LABEL_COLORS, RECURRENCE_OPTIONS, ENERGY_TYPES, AVOIDANCE_ENERGY_TYPES }
