// todayModel.js — what the Kept 2.0 Today screen shows, and why.
//
// Pure: tasks, routines, settings, calendar events and `now` in; sections out.
// No storage, no network, no React. TodayKept2.jsx renders whatever this
// returns; scripts/todayModel.test.mjs pins the rules.
//
// The screen is evidence-driven, not clock-driven. Every section answers "is
// there something here worth saying?" and is absent when the answer is no:
//
//   Needs attention   accepted, open tasks with a concrete reason (critical,
//                     overdue, due today, reminder passed, back from snooze)
//   Routines          checklists (stacks) whose cycle is open, at a prominence
//                     tier set by evidence; loop tasks due today
//   Worth doing next  one explainable pick from the existing impactRank, only
//                     if it clears the bar and (when a calendar commitment is
//                     ahead and the task has a size) fits before it
//   Coming up         fixed-time things still ahead today; Tomorrow once none are
//   Review            a count of pending Gmail/Notion suggestions. Pending items
//                     appear NOWHERE else: they are not commitments yet
//
// Durations come only from a task's own size (the same XS–XL → minutes table
// the calendar push uses). Free time comes only from real calendar events. No
// travel or prep buffer is assumed; when we don't know, we don't claim.

import { impactRank } from './scoring.js'
import { localYMD } from './dates.js'
import { reconcileCandidates } from './creditYesterday.js'

// Same table as SIZE_TO_MINUTES in src/api.js (the GCal push).
export const SIZE_MINUTES = { XS: 15, S: 30, M: 60, L: 120, XL: 240 }

export const ATTENTION_LIMIT = 5
export const COMING_LIMIT = 6
export const NOT_NOW_MAX = 2          // dismissals per day before the section rests
export const ROUTINE_WINDOW_HOURS = 6 // a checklist's window when no later checklist starts sooner
export const DORMANT_DAYS = 14        // no member caught in this long → quiet one line
export const LEAVING_SOON_MIN = 20    // a commitment this close quiets checklists

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']
const PICKABLE = ['not_started', 'doing', 'in_progress']

const ATTENTION_ORDER = { critical: 0, overdue: 1, due: 2, reminder: 3, back: 4 }

// ── small date helpers (local time) ────────────────────────────────────────
const ms = (v) => (v == null ? NaN : new Date(v).getTime())
const ymdOf = (v) => localYMD(new Date(v))
function addDaysYmd(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  return localYMD(new Date(y, m - 1, d + n))
}
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}
function atClock(key, hhmm) {
  const [y, m, d] = key.split('-').map(Number)
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0).getTime()
}
const clockMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return Number.isFinite(h) ? h * 60 + (m || 0) : null
}
const dueKey = (t) => (t.due_date ? String(t.due_date).slice(0, 10) : null)
const snoozedAt = (t, nowMs) => t.snoozed_until != null && ms(t.snoozed_until) > nowMs

export function inQuietHours(settings = {}, now = new Date()) {
  if (!settings.quiet_hours_enabled) return false
  const s = clockMinutes(settings.quiet_hours_start)
  const e = clockMinutes(settings.quiet_hours_end)
  if (s == null || e == null || s === e) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  return s < e ? cur >= s && cur < e : cur >= s || cur < e
}

// ── calendar ───────────────────────────────────────────────────────────────
// Raw events are what GET /api/gcal/events returns. A task that was imported
// from an event (gcal_event_id) already shows as a task, so its event is dropped
// here rather than listed twice.
export function normalizeEvents(raw, tasks = []) {
  if (!Array.isArray(raw)) return []
  const imported = new Set(tasks.map(t => t.gcal_event_id).filter(Boolean))
  const out = []
  for (const e of raw) {
    if (!e || e.status === 'cancelled' || imported.has(e.id)) continue
    const timed = !!e.start?.dateTime
    const startMs = timed ? ms(e.start.dateTime) : null
    const endMs = timed && e.end?.dateTime ? ms(e.end.dateTime) : null
    out.push({
      id: e.id,
      title: e.title || e.summary || '(No title)',
      location: e.location || '',
      allDay: !timed,
      day: timed ? ymdOf(startMs) : String(e.start?.date || '').slice(0, 10),
      startMs,
      endMs,
      // Free events (transparency: transparent) are on the calendar but don't
      // claim the time, so they never shorten the window for a recommendation.
      busy: timed && e.transparency !== 'transparent',
    })
  }
  return out.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
}

// ── recommendation reasons ─────────────────────────────────────────────────
// Built from the same factors impactRank scores, so the line says why it ranked.
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function dueLabel(key, todayKey) {
  const diff = daysBetween(todayKey, key)
  if (diff === 1) return 'due tomorrow'
  const [y, m, d] = key.split('-').map(Number)
  return `due ${WEEKDAY[new Date(y, m - 1, d).getDay()]}`
}

export function explainPick(task, ctx = {}, todayKey) {
  const reasons = []
  const due = dueKey(task)
  if (due && due > todayKey && daysBetween(todayKey, due) <= 7) reasons.push(dueLabel(due, todayKey))
  if (task.impact === 3) reasons.push('high impact')
  if (task.high_priority) reasons.push('marked high priority')
  if (ctx.weatherWindowActive && ctx.isOutdoor && ctx.isOutdoor(task)) reasons.push('good weather before it turns')
  return reasons
}

function clearsBar(task, todayKey) {
  const due = dueKey(task)
  const soon = due && due > todayKey && daysBetween(todayKey, due) <= 7
  return !!(soon || task.impact === 3 || task.high_priority)
}

const reasonKey = (task) => [dueKey(task) || '', task.impact ?? '', task.high_priority ? 1 : 0].join('|')

// ── the model ──────────────────────────────────────────────────────────────
/**
 * @param {object} input
 * @param {object[]} input.tasks
 * @param {object[]} input.routines
 * @param {object}   input.settings     the settings blob (quiet hours, away_days)
 * @param {Date}     input.now
 * @param {object[]|null} input.events  normalizeEvents() output, or null if unknown
 * @param {object}   input.rankCtx      buildImpactCtx() output (impactRank's context)
 * @param {function} input.isCrisis     task → bool (the critical label)
 * @param {object}   input.notNow       { date, entries: { [taskId]: reasonKey } } for today
 * @param {boolean}  input.lastNightHidden  the existing per-device "Not now" on Last night
 */
export function buildTodayModel({
  tasks = [], routines = [], settings = {}, now = new Date(), events = null,
  rankCtx = {}, isCrisis = () => false, notNow = null, lastNightHidden = false,
} = {}) {
  const nowMs = now.getTime()
  const todayKey = localYMD(now)
  const tomorrowKey = addDaysYmd(todayKey, 1)
  const ctx = { ...rankCtx, todayYmd: todayKey, nowMs }
  const rank = (t) => impactRank(t, ctx)

  const routineById = new Map(routines.map(r => [r.id, r]))
  const isStack = (r) => Array.isArray(r?.members) && r.members.length > 0
  const isRoutineTask = (t) => !!(t.routine_id && routineById.has(t.routine_id))
  const live = (t) => !t.parent_id && !t.gmail_pending && ACTIVE.includes(t.status)

  const evs = Array.isArray(events) ? events : []
  const nextCommitment = evs.find(e => e.busy && e.day === todayKey && e.startMs > nowMs) || null
  const quiet = inQuietHours(settings, now)

  // ── Needs attention ─────────────────────────────────────────────────────
  const attentionAll = []
  for (const t of tasks) {
    if (!live(t) || isRoutineTask(t) || snoozedAt(t, nowMs)) continue
    const due = dueKey(t)
    let reason = null
    if (isCrisis(t)) reason = { key: 'critical' }
    else if (due && due < todayKey) reason = { key: 'overdue', days: daysBetween(due, todayKey) }
    else if (due === todayKey) reason = { key: 'due' }
    else if (t.remind_at && ms(t.remind_at) <= nowMs) reason = { key: 'reminder', at: ms(t.remind_at) }
    else if (t.snoozed_until && ymdOf(t.snoozed_until) === todayKey) reason = { key: 'back' }
    if (reason) attentionAll.push({ task: t, reason, rank: rank(t) })
  }
  attentionAll.sort((a, b) => (ATTENTION_ORDER[a.reason.key] - ATTENTION_ORDER[b.reason.key]) || (b.rank - a.rank))
  const attentionIds = new Set(attentionAll.map(a => a.task.id))
  const attention = {
    items: attentionAll.slice(0, ATTENTION_LIMIT),
    overflow: Math.max(0, attentionAll.length - ATTENTION_LIMIT),
  }

  // ── Routines ────────────────────────────────────────────────────────────
  const awayToday = (settings.away_days || []).includes(todayKey)
  const ended = (r) => r.end_date && nowMs > new Date(`${r.end_date}T23:59:59`).getTime()
  const resting = (r) => r.paused || ended(r) || (r.resume_at && String(r.resume_at).slice(0, 10) > todayKey)
    || (r.skipped_days || []).includes(todayKey) || awayToday
  const stackTriggers = routines
    .filter(r => isStack(r) && !resting(r) && clockMinutes(r.trigger_time) != null)
    .map(r => ({ id: r.id, at: atClock(todayKey, r.trigger_time) }))
  const leavingSoon = nextCommitment && (nextCommitment.startMs - nowMs) <= LEAVING_SOON_MIN * 60000
  const dormantSince = nowMs - DORMANT_DAYS * 86400000

  const checklists = []
  for (const r of routines) {
    if (!isStack(r) || resting(r)) continue
    const byCycle = new Map()
    let caughtRecently = false
    for (const t of tasks) {
      if (t.routine_id !== r.id) continue
      if (t.status === 'done' && ms(t.completed_at) >= dormantSince) caughtRecently = true
      if (['cancelled', 'backlog', 'project'].includes(t.status)) continue
      const due = dueKey(t)
      if (!due || due > todayKey) continue
      if (!byCycle.has(due)) byCycle.set(due, { due, open: [], total: 0, done: 0 })
      const c = byCycle.get(due)
      c.total++
      if (t.status === 'done') c.done++
      else if (!snoozedAt(t, nowMs)) c.open.push(t)
    }
    const start = clockMinutes(r.trigger_time) != null ? atClock(todayKey, r.trigger_time) : atClock(todayKey, '00:00')
    const nextStart = stackTriggers.filter(s => s.id !== r.id && s.at > start).map(s => s.at)
    const windowEnd = Math.min(start + ROUTINE_WINDOW_HOURS * 3600000, ...nextStart)
    for (const c of [...byCycle.values()].filter(c => c.open.length > 0).sort((a, b) => a.due.localeCompare(b.due))) {
      let tier = 'full'
      let note = null
      if (c.due < todayKey) { tier = 'line'; note = c.due === addDaysYmd(todayKey, -1) ? 'left from yesterday' : 'left from earlier' }
      else if (nowMs > windowEnd) { tier = 'line'; note = start < atClock(todayKey, '12:00') ? 'left from this morning' : 'left from earlier' }
      else if (leavingSoon) { tier = 'line'; note = `before ${nextCommitment.title}` }
      else if (!caughtRecently) { tier = 'line'; note = null }
      checklists.push({ routine: r, due: c.due, open: c.open, done: c.done, total: c.total, tier, note })
    }
  }
  checklists.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'full' ? -1 : 1))

  // Plain loops spawn ordinary tasks; the ones due today (or carried over) show
  // here, completed through the normal task path.
  const loopTasks = tasks.filter(t => live(t) && isRoutineTask(t) && !isStack(routineById.get(t.routine_id))
    && !snoozedAt(t, nowMs) && dueKey(t) && dueKey(t) <= todayKey)
    .map(t => ({ task: t, routine: routineById.get(t.routine_id), overdueDays: daysBetween(dueKey(t), todayKey) }))
    .sort((a, b) => b.overdueDays - a.overdueDays || rank(b.task) - rank(a.task))

  // ── Worth doing next ────────────────────────────────────────────────────
  let next = null
  let nextAbsent = null
  const dismissed = notNow && notNow.date === todayKey ? (notNow.entries || {}) : {}
  if (quiet) nextAbsent = 'quiet'
  else if (Object.keys(dismissed).length >= NOT_NOW_MAX) nextAbsent = 'dismissed'
  else {
    const freeMin = nextCommitment ? Math.floor((nextCommitment.startMs - nowMs) / 60000) : null
    const pool = tasks
      .filter(t => !t.parent_id && !t.gmail_pending && PICKABLE.includes(t.status) && !snoozedAt(t, nowMs)
        && !t.routine_id && !attentionIds.has(t.id) && !isCrisis(t) && clearsBar(t, todayKey)
        && dismissed[t.id] !== reasonKey(t))
      .map(t => ({ t, r: rank(t) }))
      .sort((a, b) => b.r - a.r || String(dueKey(a.t) || '9999').localeCompare(String(dueKey(b.t) || '9999')) || String(a.t.id).localeCompare(String(b.t.id)))
    for (const { t } of pool) {
      const minutes = SIZE_MINUTES[t.size] ?? null
      if (freeMin != null && minutes != null && minutes > freeMin) continue
      next = {
        task: t,
        reasons: explainPick(t, ctx, todayKey),
        minutes,
        fitsBefore: freeMin != null && minutes != null ? nextCommitment : null,
        reasonKey: reasonKey(t),
      }
      break
    }
    if (!next) nextAbsent = 'none'
  }

  // ── Coming up / Tomorrow ────────────────────────────────────────────────
  const shownIds = new Set([...attentionIds, ...loopTasks.map(l => l.task.id)])
  const ahead = []
  for (const e of evs) {
    if (e.allDay || e.day !== todayKey) continue
    if ((e.endMs ?? e.startMs) <= nowMs) continue
    ahead.push({ kind: 'event', at: e.startMs, event: e, ongoing: e.startMs <= nowMs })
  }
  const stackLater = new Map()
  for (const t of tasks) {
    if (!live(t) || shownIds.has(t.id)) continue
    const r = t.routine_id ? routineById.get(t.routine_id) : null
    if (t.remind_at && ymdOf(t.remind_at) === todayKey && ms(t.remind_at) > nowMs && !snoozedAt(t, nowMs)) {
      ahead.push({ kind: 'reminder', at: ms(t.remind_at), task: t })
    } else if (snoozedAt(t, nowMs) && ymdOf(t.snoozed_until) === todayKey) {
      const at = ms(t.snoozed_until)
      if (r && isStack(r)) {
        const cur = stackLater.get(r.id)
        if (!cur) stackLater.set(r.id, { kind: 'checklist', at, routine: r, count: 1 })
        else { cur.count++; cur.at = Math.min(cur.at, at) }
      } else {
        ahead.push({ kind: r ? 'loop' : 'returns', at, task: t, routine: r || null })
      }
    }
  }
  ahead.push(...stackLater.values())
  ahead.sort((a, b) => a.at - b.at)

  let coming
  if (ahead.length > 0 && !quiet) {
    coming = { label: 'Coming up', day: todayKey, items: ahead.slice(0, COMING_LIMIT) }
  } else {
    const tmr = []
    for (const e of evs) {
      if (e.day !== tomorrowKey || e.allDay) continue
      tmr.push({ kind: 'event', at: e.startMs, event: e })
    }
    for (const t of tasks) {
      if (!live(t) || attentionIds.has(t.id) || t.id === next?.task.id) continue
      if (t.remind_at && ymdOf(t.remind_at) === tomorrowKey) tmr.push({ kind: 'reminder', at: ms(t.remind_at), task: t })
      else if (dueKey(t) === tomorrowKey && !(t.routine_id && isStack(routineById.get(t.routine_id)))) {
        tmr.push({ kind: 'due', at: atClock(tomorrowKey, '23:59'), task: t })
      }
    }
    tmr.sort((a, b) => a.at - b.at)
    // Quiet hours with things still ahead tonight: keep tonight, it's what's next.
    coming = ahead.length > 0
      ? { label: 'Coming up', day: todayKey, items: ahead.slice(0, COMING_LIMIT) }
      : { label: 'Tomorrow', day: tomorrowKey, items: tmr.slice(0, COMING_LIMIT) }
  }

  // ── Review, Last night, the quiet extras ────────────────────────────────
  const pending = tasks.filter(t => t.gmail_pending)
  const review = {
    count: pending.length,
    source: pending.length && pending.every(t => t.gmail_message_id) ? 'Gmail'
      : pending.length && pending.every(t => t.notion_page_id) ? 'Notion' : null,
    items: pending,
  }
  const lastNight = lastNightHidden ? [] : reconcileCandidates(tasks, now)

  const anytime = tasks.filter(t => live(t) && !t.due_date && !t.remind_at && !t.routine_id
    && !snoozedAt(t, nowMs) && !attentionIds.has(t.id) && t.id !== next?.task.id)
    .sort((a, b) => rank(b) - rank(a))

  const pinnedArcs = tasks.filter(t => t.status === 'project' && t.pinned_to_today).map(p => ({
    arc: p,
    children: tasks.filter(t => t.parent_id === p.id && t.child_visibility === 'active'
      && ACTIVE.includes(t.status) && !snoozedAt(t, nowMs)),
  }))

  const allClear = attention.items.length === 0 && checklists.length === 0 && loopTasks.length === 0
    && !next && review.count === 0 && lastNight.length === 0

  return {
    todayKey, tomorrowKey, nowMs, quiet,
    attention, checklists, loopTasks, next, nextAbsent, nextCommitment,
    coming, review, lastNight, anytime, pinnedArcs, allClear,
  }
}

// ── Not now (per device, per day) ──────────────────────────────────────────
// The record is cosmetic: the task is never touched. Same idea and lifetime as
// the Last night "Not now" (boom_lastnight_hidden_on).
export function recordNotNow(state, todayKey, taskId, key) {
  const base = state && state.date === todayKey ? state : { date: todayKey, entries: {} }
  return { date: todayKey, entries: { ...base.entries, [taskId]: key } }
}
