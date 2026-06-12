import { localYMD, parseLocalDate } from './dates'
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
  // Knowledge base: the database id/url live in STANDALONE server keys
  // (app_data 'notion_knowledge_db_id'), NOT in this settings blob. The
  // decoy blob keys that used to sit here misled Quokka into declaring a
  // working KB "unconfigured" (its get_settings reads the blob), and the
  // repair overwrote the real key — removed 2026-06-12. last_sync is a
  // server-side standalone key too.
  sort_by: 'age',
  daily_task_goal: 3,
  daily_points_goal: 15,
  // 7-day calendar strip above the task sections. Opt-in in light/dark,
  // auto-on in terminal mode. Today's cell shows N/goal inline + intensity
  // fill; this is the single source of truth for daily-goal progress
  // (GoalProgressBar was removed 2026-05-11).
  show_week_strip: false,
  // Per-section collapsed state on the home task list. Map of section
  // name → bool (true = collapsed). Synced via settings so the preference
  // persists across reloads. Sections not in the map default to expanded.
  collapsed_sections: {},
  // Days the user won the hidden tic-tac-toe Easter egg. Map of
  // ISO date → true. Each win contributes +1 task + +1 point to that
  // day's computeDailyStats, but only once per day. Trigger: 7-tap the
  // EditTaskModal title (Android-build-number metaphor).
  easter_egg_wins: {},
  // When true, the day cells stay expanded all the time. When false
  // (default), the strip renders collapsed — just the range label +
  // today's count — and tapping the range expands the days.
  week_strip_always_open: false,
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
// Colors resolve through the --energy-* CSS tokens (tokens.css defines the
// standard values; wallaby/kept palettes override) so every theme tunes the
// energy accents in ONE place. Consumers pass these straight to inline
// style/SVG color attributes — CSS vars are valid there.
const ENERGY_TYPES = [
  { id: 'desk', label: 'Desk', icon: 'Monitor', color: 'var(--energy-desk)' },
  { id: 'people', label: 'People', icon: 'Users', color: 'var(--energy-people)' },
  { id: 'errand', label: 'Errand', icon: 'MapPin', color: 'var(--energy-errand)' },
  { id: 'creative', label: 'Creative', icon: 'Palette', color: 'var(--energy-creative)' },
  { id: 'physical', label: 'Physical', icon: 'Dumbbell', color: 'var(--energy-physical)' },
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

// LOCAL-timezone YYYY-MM-DD key. Prefer this over `date.toISOString().slice(0, 10)`
// for anything that represents the user's calendar day (today, due dates,
// streak buckets, easter-egg wins). The toISOString variant converts to UTC
// first — for a user in Central time, after ~6pm CST that flips the key to
// the next calendar day and causes subtle off-by-one bugs across the UI.
// Pass no argument to get today's local key.
// Delegates to the canonical date module (src/dates.js) — kept as a
// re-export so the dozens of existing `from './store'` imports keep working.
export { localYMD, parseLocalDate }

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
  // Theme migration shims. Terminal was removed 2026-06-10 and Wallaby was
  // torn down 2026-06-12 (K6) — every legacy value lands on Kept silently.
  // Saved back so the next read short-circuits.
  if (saved.theme && /^(terminal|wallaby)/.test(saved.theme)) {
    saved.theme = saved.theme.endsWith('-light') ? 'kept-light' : 'kept-dark'
    save(SETTINGS_KEY, saved)
  }

  // Kept cutover (K6, 2026-06-10): NEW installs default to Kept, following
  // the system color scheme at first load. Existing users keep whatever
  // theme they had — only an unset theme gets the default.
  if (!saved.theme) {
    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-color-scheme: dark)')?.matches
    saved.theme = prefersDark ? 'kept-dark' : 'kept-light'
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
    stack_bonus: null,   // bonus points stamped on the task that clears a routine
                         // "stack" cycle (20% of the cycle's combined member points)
  }
}

export function createRoutine(title, cadence, customDays = null, tags = [], notes = '', customUnit = 'days') {
  return {
    id: uuid(),
    title,
    cadence, // daily, weekly, monthly, quarterly, annually, custom
    custom_days: customDays, // for 'custom': integer interval (in whatever unit)
    custom_unit: customUnit, // for 'custom': 'days' (default) or 'months'
    schedule_day_of_week: null, // weekday anchor (0=Sun … 6=Sat). For weekly =
                                // "every <weekday>". For month-scale cadences,
                                // combined with schedule_week_of_month for an
                                // ordinal weekday ("1st Mon", "last Fri").
    schedule_day_of_month: null,  // month-scale: fixed calendar day 1..31
                                  // ("the 18th"). Clamped to month length.
    schedule_week_of_month: null, // month-scale: 1,2,3,4 or -1 (last). With
                                  // schedule_day_of_week → ordinal weekday.
    trigger_time: null,  // optional 'HH:MM' 24h local time. When set, spawned
                         // tasks are snoozed until this clock time on their due
                         // day (don't surface or nag before it). Null = any time.
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
    auto_roll: false,    // when true, the scheduled spawn rolls an existing
                         // active instance forward instead of stacking a new
                         // task. Use case: pills, anything you can't double up
                         // on. Full spec: wiki/Activity-Prompts.md.
    spawn_mode: 'auto',  // 'auto' (cadence-driven) | 'habit' (target frequency,
                         // no auto-spawn, "+ Log it" + behind-pace nudges).
                         // Habit mode ignores cadence + schedule_day_of_week
                         // + auto_roll.
    target_count: null,  // habit mode: completions per period (e.g. 2)
    target_period: null, // habit mode: 'week' or 'month'
    gcal_recurring_event_id: null, // Google Calendar recurring event ID
    members: [],         // routine "stack" members. Non-empty ⇒ this routine
                         // fans out into one independent task per member each
                         // cycle (vs follow_ups, which are a dependent chain).
                         // Shape: [{ id, title, energy_type?, energy_level?,
                         // notes?, tags? }]. Clearing all members of a cycle
                         // pays a 20% bonus.
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

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

// The Nth (n = 1..4) or last (n = -1) occurrence of `weekday` (0=Sun..6=Sat)
// in the given year/month. Returns a startOfDay Date.
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    const last = daysInMonth(year, month)
    const back = (new Date(year, month, last).getDay() - weekday + 7) % 7
    return new Date(year, month, last - back)
  }
  const firstDow = new Date(year, month, 1).getDay()
  const offset = (weekday - firstDow + 7) % 7
  let day = 1 + offset + (n - 1) * 7
  if (day > daysInMonth(year, month)) day -= 7 // no Nth occurrence → use prior week
  return new Date(year, month, day)
}

// Resolve the scheduled calendar date within a target month for a month-scale
// routine, per its anchor rule (see migration 034). `createdDom` is the
// routine's creation day-of-month, used as the fallback anchor.
function resolveMonthDay(year, month, routine, createdDom) {
  const dom = routine.schedule_day_of_month
  const wom = routine.schedule_week_of_month
  const dow = routine.schedule_day_of_week
  if (dom != null) {
    return new Date(year, month, Math.min(Math.max(dom, 1), daysInMonth(year, month)))
  }
  if (wom != null && dow != null) {
    return nthWeekdayOfMonth(year, month, dow, wom)
  }
  if (dow != null) {
    // Legacy: anchor on the creation day-of-month, snapped forward to weekday.
    const base = new Date(year, month, Math.min(createdDom, daysInMonth(year, month)))
    return snapToWeekday(base, dow)
  }
  return new Date(year, month, Math.min(createdDom, daysInMonth(year, month)))
}

// Advance `date` by `mult` cadence intervals (used for anchor-less, interval
// cadences like "every 180 days" / "every N months").
function addCadenceInterval(date, routine, mult) {
  const d = new Date(date)
  switch (routine.cadence) {
    case 'daily': d.setDate(d.getDate() + mult); break
    case 'weekly': d.setDate(d.getDate() + 7 * mult); break
    case 'monthly': d.setMonth(d.getMonth() + mult); break
    case 'quarterly': d.setMonth(d.getMonth() + 3 * mult); break
    case 'annually': d.setFullYear(d.getFullYear() + mult); break
    case 'custom': {
      const interval = routine.custom_days || 7
      if (routine.custom_unit === 'months') d.setMonth(d.getMonth() + interval * mult)
      else d.setDate(d.getDate() + interval * mult)
      break
    }
    default: d.setDate(d.getDate() + 7 * mult)
  }
  return d
}

// Next-due. Two models, chosen by whether the routine has an explicit calendar
// anchor:
//   • ANCHORED (weekly + weekday, or month-scale with a day-of-month / ordinal-
//     weekday / legacy-weekday rule) → a FIXED GRID. Completing early or late
//     never shifts the series — "every Friday" stays Friday, "the 18th" stays
//     the 18th.
//   • ANCHOR-LESS interval cadence (every N days, every N months, or weekly/
//     monthly with no specific day) → relative to the last completion: next =
//     lastDone + one interval (or created_at + interval if never done). "Every
//     180 days" means 180 days after you last did it, not a grid pinned to the
//     creation date.
// Daily is special-cased: it fires every calendar day.
export function getNextDueDate(routine) {
  const now = new Date()

  // Daily fires every calendar day — just gate on whether today's instance is
  // already done. No grid math needed (and avoids a huge day-by-day walk).
  if (routine.cadence === 'daily') {
    const today = startOfDay(now)
    const last = routine.completed_history.length > 0
      ? startOfDay(routine.completed_history[routine.completed_history.length - 1])
      : null
    if (last && last.getTime() >= today.getTime()) {
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)
      return tomorrow
    }
    return today
  }

  const createdStart = startOfDay(routine.created_at)
  const dow = routine.schedule_day_of_week
  const monthScale = routine.cadence === 'monthly' || routine.cadence === 'quarterly'
    || routine.cadence === 'annually'
    || (routine.cadence === 'custom' && routine.custom_unit === 'months')

  const lastDone = routine.completed_history.length > 0
    ? new Date(routine.completed_history[routine.completed_history.length - 1])
    : null

  // No explicit calendar anchor → interval-relative ("every N after last done").
  // Month-scale counts a day-of-month / ordinal-week / legacy-weekday rule as an
  // anchor; weekly counts a weekday. Everything else (custom-days, custom-months
  // with no rule, weekly/monthly with no day) recurs from the last completion.
  const hasAnchor = monthScale
    ? (routine.schedule_day_of_month != null || routine.schedule_week_of_month != null || dow != null)
    : (routine.cadence === 'weekly' && dow != null)
  if (!hasAnchor) {
    return addCadenceInterval(lastDone || createdStart, routine, 1)
  }

  let gridPoint
  if (monthScale) {
    const intervalMonths = routine.cadence === 'monthly' ? 1
      : routine.cadence === 'quarterly' ? 3
      : routine.cadence === 'annually' ? 12
      : (routine.custom_days || 1)
    const baseY = createdStart.getFullYear()
    const baseM = createdStart.getMonth()
    const createdDom = createdStart.getDate()
    gridPoint = (k) => {
      const total = baseM + k * intervalMonths
      const y = baseY + Math.floor(total / 12)
      const m = ((total % 12) + 12) % 12
      return resolveMonthDay(y, m, routine, createdDom)
    }
  } else {
    // Day-scale: weekly (fold weekday into the origin) or custom-days.
    let anchor = createdStart
    if (routine.cadence === 'weekly' && dow != null) anchor = snapToWeekday(anchor, dow)
    const stepDays = routine.cadence === 'weekly' ? 7 : (routine.custom_days || 7)
    // Legacy custom-days weekday snap (exotic combo; weekly is folded above).
    const snap = (d) => (dow != null && routine.cadence !== 'weekly') ? snapToWeekday(d, dow) : d
    gridPoint = (k) => {
      const d = new Date(anchor)
      d.setDate(d.getDate() + k * stepDays)
      return snap(d)
    }
  }

  // Series start: first grid slot on or after the creation date (a day-of-month
  // rule can place gridPoint(0) before creation, e.g. created the 20th with the
  // rule "the 18th" → the series starts next month's 18th).
  let k0 = 0
  let g0 = 0
  while (gridPoint(k0).getTime() < createdStart.getTime() && g0 < 12000) { k0++; g0++ }

  // Never completed, or completed before the series even started → series start.
  if (!lastDone || lastDone.getTime() < gridPoint(k0).getTime()) return gridPoint(k0)

  // Walk to the slot the last completion satisfied (largest slot <= lastDone),
  // then return the NEXT slot. Guard caps pathological histories.
  let k = k0
  let guard = 0
  while (gridPoint(k + 1).getTime() <= lastDone.getTime() && guard < 12000) { k++; guard++ }
  return gridPoint(k + 1)
}

// Short human label for a routine's schedule anchor, e.g. "Fri", "18th",
// "1st Mon", "last Fri". Empty string when there's no explicit anchor (or
// daily). Used in routine card meta in both UIs.
const SCHED_ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', '-1': 'last' }
const SCHED_DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function ordinalDayOfMonth(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
export function formatScheduleAnchor(routine) {
  if (!routine || routine.cadence === 'daily') return ''
  const monthScale = routine.cadence === 'monthly' || routine.cadence === 'quarterly'
    || routine.cadence === 'annually'
    || (routine.cadence === 'custom' && routine.custom_unit === 'months')
  if (monthScale) {
    if (routine.schedule_day_of_month != null) return ordinalDayOfMonth(routine.schedule_day_of_month)
    if (routine.schedule_week_of_month != null && routine.schedule_day_of_week != null) {
      return `${SCHED_ORDINALS[routine.schedule_week_of_month]} ${SCHED_DAY_SHORT[routine.schedule_day_of_week]}`
    }
  }
  if (routine.schedule_day_of_week != null) return SCHED_DAY_SHORT[routine.schedule_day_of_week]
  return ''
}

export function isRoutineDue(routine) {
  if (routine.paused) return false
  // Habit-mode routines have no cadence — they never "spawn due" the
  // automatic way. Users log them proactively via "+ Log it" or through
  // a behind-pace push nudge. Skip entirely.
  if (routine.spawn_mode === 'habit') return false
  if (routine.end_date) {
    const endOfDay = new Date(routine.end_date + 'T23:59:59')
    if (Date.now() > endOfDay.getTime()) return false
  }
  const nextDue = getNextDueDate(routine)
  return Date.now() >= nextDue.getTime()
}

export function formatCadence(routine) {
  if (routine.cadence === 'custom') {
    const n = routine.custom_days
    const unit = routine.custom_unit === 'months' ? 'mo' : 'd'
    return `every ${n}${unit}`
  }
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

// Compute current period boundaries for a habit-mode routine.
// weekStartsOn: 0=Sun, 1=Mon (default). For 'month', always calendar month.
// Returns { start: Date, end: Date, lengthDays: number }. Both bounds are
// inclusive at start-of-day / exclusive at next-period-start.
export function getHabitPeriodBounds(period, weekStartsOn = 1, now = new Date()) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === 'week') {
    const dow = start.getDay()
    const diff = (dow - weekStartsOn + 7) % 7
    start.setDate(start.getDate() - diff)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    return { start, end, lengthDays: 7 }
  }
  // month
  start.setDate(1)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  const lengthDays = Math.round((end.getTime() - start.getTime()) / 86400000)
  return { start, end, lengthDays }
}

// Count completions linked to a habit routine in [start, end).
function countHabitCompletions(routineId, tasks, start, end) {
  return tasks.filter(t => {
    if (t.routine_id !== routineId) return false
    if (!t.completed_at) return false
    const c = new Date(t.completed_at).getTime()
    return c >= start.getTime() && c < end.getTime()
  }).length
}

// Streak: walk backwards period-by-period from the most recently completed
// period (not including current). Each period that hit target adds 1.
// Periods where target_count is 0 are skipped — paused / inactive periods
// don't reset the streak (mirrors computeStreak's no-fault day semantics).
function computeHabitStreak(routine, tasks, weekStartsOn) {
  if (!routine.target_count) return 0
  const periodStartOf = routine.target_period === 'week'
    ? (d) => {
        const out = new Date(d); out.setHours(0, 0, 0, 0)
        const diff = (out.getDay() - weekStartsOn + 7) % 7
        out.setDate(out.getDate() - diff)
        return out
      }
    : (d) => {
        const out = new Date(d); out.setHours(0, 0, 0, 0); out.setDate(1)
        return out
      }

  // Start at the period BEFORE current.
  const currentStart = periodStartOf(new Date())
  let cursorStart = new Date(currentStart)
  if (routine.target_period === 'week') cursorStart.setDate(cursorStart.getDate() - 7)
  else cursorStart.setMonth(cursorStart.getMonth() - 1)

  let streak = 0
  // Cap walk at 52 periods (year) to avoid runaway in case of bad data.
  for (let i = 0; i < 52; i++) {
    const cursorEnd = new Date(cursorStart)
    if (routine.target_period === 'week') cursorEnd.setDate(cursorEnd.getDate() + 7)
    else cursorEnd.setMonth(cursorEnd.getMonth() + 1)
    const completions = countHabitCompletions(routine.id, tasks, cursorStart, cursorEnd)
    if (completions >= routine.target_count) {
      streak++
      // step back one period
      if (routine.target_period === 'week') cursorStart.setDate(cursorStart.getDate() - 7)
      else cursorStart.setMonth(cursorStart.getMonth() - 1)
    } else {
      break
    }
  }
  return streak
}

// Return habit stats for an active habit-mode routine, or null if not habit.
//   completions: int — number of completions in current period
//   target: int — routine.target_count
//   period_start / period_end: Date objects (start inclusive, end exclusive)
//   streak: consecutive prior periods that hit target
//   behind_pace: bool — true if completions are below expected linear pace
//                       AND we're past the early "give-it-a-rest" window
export function computeHabitStats(routine, tasks, weekStartsOn = 1) {
  if (!routine || routine.spawn_mode !== 'habit' || !routine.target_count || !routine.target_period) {
    return null
  }
  const { start, end, lengthDays } = getHabitPeriodBounds(routine.target_period, weekStartsOn)
  const completions = countHabitCompletions(routine.id, tasks, start, end)
  const elapsedMs = Date.now() - start.getTime()
  const elapsedDays = Math.max(0, elapsedMs / 86400000)
  const elapsedRatio = Math.min(1, elapsedDays / lengthDays)
  const expectedAtPace = elapsedRatio * routine.target_count
  // Don't fire "behind pace" warnings in the first 30% of the period — early
  // is normal, not a problem.
  const behindPace = completions < expectedAtPace && elapsedRatio >= 0.3 && completions < routine.target_count
  return {
    period_start: start,
    period_end: end,
    completions,
    target: routine.target_count,
    streak: computeHabitStreak(routine, tasks, weekStartsOn),
    behind_pace: behindPace,
    elapsed_ratio: elapsedRatio,
  }
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

export function formatSnoozeLabel(dateStr, opts = {}) {
  const date = new Date(dateStr)
  // "Later — set aside" sentinel: any date past year 2099. Used by the
  // indefinite-snooze option. Caller can also pass {indefinite: true} for
  // explicit checks against task.snooze_indefinite.
  if (opts.indefinite || date.getFullYear() >= 2099) return 'set aside'
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
  return localYMD(d)
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

// Did the user have any actionable tasks on a given date? Used by
// computeStreak to skip "empty days" (no tasks queued, nothing due) so
// the streak doesn't punish for not gaming the list to keep it alive.
// A task counts as actionable on date D if:
//   - status is active (not done before D, not backlog/project/cancelled)
//   - created_at <= end-of-D (existed by then)
//   - snoozed_until is null or <= end-of-D (not snoozed past it)
// Tasks that were completed ON D obviously count (they're an action).
function hadActiveTasksOnDay(tasks, date) {
  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  for (const t of tasks) {
    if (['backlog', 'project', 'cancelled'].includes(t.status)) continue
    if (!t.created_at) continue
    const created = new Date(t.created_at)
    if (created > endOfDay) continue
    // If already completed before this day, it wasn't actionable on D.
    if (t.status === 'done' && t.completed_at) {
      const completed = new Date(t.completed_at)
      if (completed < startOfDay) continue
    }
    // If snoozed past end-of-day, it wasn't actionable on D.
    if (t.snoozed_until) {
      const snoozedUntil = new Date(t.snoozed_until)
      if (snoozedUntil > endOfDay) continue
    }
    return true
  }
  return false
}

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
  const easterEggWins = settings.easter_egg_wins || {}
  // Durable provenance for completion days whose task rows were deleted —
  // stamped server-side by deleteTask (see db.js). Without this, deleting
  // a done task retroactively turned its day into a fault day.
  const provenanceDays = new Set(settings.completion_days || [])

  // Count consecutive days with at least 1 completion (or a free day),
  // working backward from today. Empty-task days (no completions AND no
  // tasks were active on that day) are treated as no-fault — the streak
  // continues across them. Easter-egg wins count as a completion.
  // Project session logs also count as completions for streak purposes —
  // chipping away at a project counts as "did something today" the same
  // as ticking off a one-shot task.
  const completionDates = new Set()
  let earliest = null
  for (const t of tasks) {
    if (t.status === 'done' && t.completed_at) {
      completionDates.add(new Date(t.completed_at).toDateString())
    }
    if (t.status === 'waiting' && t.waiting_at) {
      completionDates.add(new Date(t.waiting_at).toDateString())
    }
    if (t.status === 'project' && Array.isArray(t.session_log)) {
      for (const entry of t.session_log) {
        if (entry?.timestamp) completionDates.add(new Date(entry.timestamp).toDateString())
      }
    }
    if (t.created_at) {
      const c = new Date(t.created_at)
      if (Number.isFinite(c.getTime()) && (!earliest || c < earliest)) earliest = c
    }
  }

  // Streak floor — once we walk past the user's earliest task, there's
  // nothing meaningful before then. Without this floor, no-fault empty
  // days (which all pre-history days qualify as) would walk back
  // indefinitely until JS Date underflowed and `.toISOString()` threw.
  //
  // The floor honors `settings.streak_anchor` (a 'YYYY-MM-DD' that only
  // ever moves BACKWARD, maintained in AppV2 from tasks + the server's
  // analytics history): deriving the floor purely from live tasks meant
  // deleting your oldest record — e.g. dismissing an old Gmail import —
  // retroactively shortened the streak (prod incident: 36 → 27).
  const anchorDate = settings.streak_anchor ? parseLocalDate(settings.streak_anchor) : null
  const floorBasis = anchorDate && (!earliest || anchorDate < earliest) ? anchorDate : earliest
  const floor = floorBasis
    ? new Date(floorBasis.getFullYear(), floorBasis.getMonth(), floorBasis.getDate())
    : null

  const isNoFaultDay = (d) => {
    const iso = localYMD(d)
    if (freeDays.has(iso)) return true
    if (easterEggWins[iso]) return false // counted as completion below, not no-fault
    return !hadActiveTasksOnDay(tasks, d)
  }
  const hasCompletionOn = (d) => (
    completionDates.has(d.toDateString()) || !!easterEggWins[localYMD(d)] || provenanceDays.has(localYMD(d))
  )

  let streak = 0
  const d = new Date()
  // Today special: if nothing done today and not a no-fault day, peek at
  // yesterday before declaring the streak broken.
  if (!hasCompletionOn(d) && !isNoFaultDay(d)) {
    d.setDate(d.getDate() - 1)
    if (!hasCompletionOn(d) && !isNoFaultDay(d)) return 0
  }

  // Hard iteration cap as a defense-in-depth in case the floor logic
  // ever misbehaves. 3650 = ~10 years; well beyond any realistic streak.
  let guard = 3650
  while ((hasCompletionOn(d) || isNoFaultDay(d)) && guard-- > 0) {
    if (floor && d < floor) break
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

  const tolerance = cadenceIntervalMs(routine.cadence, routine.custom_days, routine.custom_unit) * 1.5
  let streak = 1
  for (let i = history.length - 1; i > 0; i--) {
    const a = new Date(history[i]).getTime()
    const b = new Date(history[i - 1]).getTime()
    if (a - b <= tolerance) streak++
    else break
  }
  return streak
}

function cadenceIntervalMs(cadence, customDays, customUnit = 'days') {
  const day = 24 * 60 * 60 * 1000
  switch (cadence) {
    case 'daily': return day
    case 'weekly': return 7 * day
    case 'monthly': return 30 * day
    case 'quarterly': return 91 * day
    case 'annually': return 365 * day
    case 'custom': {
      // Streak tolerance only — approximate months as 30 days. Exact
      // month-length variation (28-31) doesn't matter for the 1.5x
      // tolerance window used in computeRoutineStreak.
      const multiplier = customUnit === 'months' ? 30 : 1
      return (customDays || 1) * multiplier * day
    }
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
    // 'created' | 'completed' | 'deleted' | 'status_changed' | 'edited' |
    // 'snoozed' | 'priority_changed' | 'reopened' | 'skipped' | 'session_logged' | 'error'
    action,
    task_id: task.id,
    task_title: task.title,
    task_snapshot: { ...task },
    timestamp: new Date().toISOString(),
  })
  // Keep log bounded
  if (log.length > MAX_ACTIVITY_LOG) log.length = MAX_ACTIVITY_LOG
  saveActivityLog(log)
}

export function logSystemError(message, detail) {
  const log = loadActivityLog()
  log.unshift({
    id: uuid(),
    action: 'error',
    task_id: null,
    task_title: message,
    task_snapshot: detail ? { error: detail } : null,
    timestamp: new Date().toISOString(),
  })
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
