// todayModel.js — what the Kept 2.0 Today screen shows, and why.
//
// Pure: tasks, routines, settings, calendar events and `now` in; sections out.
// No storage, no network, no React. TodayKept2.jsx renders whatever this
// returns; scripts/todayModel.test.mjs pins the behaviour against scenarios.
//
// The product: put something down and trust it comes back at the right time.
// Today answers three questions, in this order, in one screen:
//   1. What genuinely needs me?        (Needs attention: small by construction)
//   2. What's worth doing next?        (one pick, or nothing)
//   3. What's coming up?               (later today / tonight; tomorrow; and
//                                       the next few dated things this week
//                                       when nothing nearer is on screen)
// Everything else is one compact row at most.
//
// A due date is EVIDENCE OF RELEVANCE, not proof something needs you now. The
// data can't tell a hard deadline from a hopeful one, or whether a task is
// actionable right now, so this is a conservative first pass that only treats
// EXPLICIT signals as "needs you":
//
//   needs you now   critical; due today; picked for today (committed_on);
//                   a reminder you set that went off today; due yesterday AND
//                   you marked it as mattering (high priority, nag allowed, a
//                   reminder, an escalation). A snooze ending is NOT a reason:
//                   the task resurfaces and is judged on its other evidence
//   slipped         everything else that is past its date. Not "late", not red:
//                   one quiet row that opens a deliberate review
//   waiting         on someone else. Never "needs you". After a week of waiting
//                   (waiting_at) it joins the review as a possible check-in
//   important,      high impact with no date: not on Today's main path. Impact
//   not now         is a 1–3 number, often AI-inferred; it is a tie-break, never
//                   a reason on its own
//
// Worth doing next needs a reason about TIME, not importance: picked for today,
// or due in the next few days. With no such evidence it's omitted. In the
// evening it's omitted too: tomorrow's obligations are listed under Tomorrow.
//
// The screen's ORDER follows the time of day (`order`). Evening starts by 20:00,
// earlier if an evening checklist or quiet hours start sooner. Nothing urgent
// is ever hidden by the clock; the order just puts tonight and tomorrow ahead
// of the day's leftovers.
//
// Durations come only from a task's own size (the same XS–XL → minutes table
// the calendar push uses). Free time comes only from real calendar events. No
// travel or prep buffer is assumed; when we don't know, we don't claim.

import { impactRank } from './scoring.js'
import { localYMD } from './dates.js'
import { reconcileCandidates } from './creditYesterday.js'

// Same table as SIZE_TO_MINUTES in src/api.js (the GCal push).
export const SIZE_MINUTES = { XS: 15, S: 30, M: 60, L: 120, XL: 240 }

export const ATTENTION_LIMIT = 3
export const WAITING_CHECKIN_DAYS = 7  // waiting this long → offered as a check-in in the review
export const NEXT_DUE_WINDOW_DAYS = 3  // "due soon" for Worth doing next
export const EVENING_FALLBACK = '20:00'
export const MORNING_ENDS = '11:00'
export const UPCOMING_DAYS = 7       // how far "Later this week" looks
export const UPCOMING_LIMIT = 3
export const COMING_LIMIT = 6
export const NOT_NOW_MAX = 2          // dismissals per day before the section rests
export const ROUTINE_WINDOW_HOURS = 6 // a checklist's window when no later checklist starts sooner
export const DORMANT_DAYS = 14        // no member caught in this long → quiet one line
export const LEAVING_SOON_MIN = 20    // a commitment this close quiets checklists

const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']
const PICKABLE = ['not_started', 'doing', 'in_progress']

const ATTENTION_ORDER = { critical: 0, reminder: 1, due: 2, committed: 3, recent: 4 }

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

// When does the evening start? By 20:00 at the latest. An evening checklist
// (trigger at/after 17:00) or quiet hours that start earlier bring it forward.
// Quiet hours never push it later: they mean "don't notify me", and winding
// down starts before that.
export function eveningStart(routines = [], settings = {}) {
  const candidates = [clockMinutes(EVENING_FALLBACK)]
  for (const r of routines) {
    if (!Array.isArray(r?.members) || r.members.length === 0 || r.paused) continue
    const m = clockMinutes(r.trigger_time)
    if (m != null && m >= 17 * 60) candidates.push(m)
  }
  const q = settings.quiet_hours_enabled ? clockMinutes(settings.quiet_hours_start) : null
  if (q != null && q >= 17 * 60) candidates.push(q)
  return Math.min(...candidates)
}

export function dayPhase(routines, settings, now = new Date()) {
  const cur = now.getHours() * 60 + now.getMinutes()
  if (cur < 4 * 60 || cur >= eveningStart(routines, settings)) return 'evening'
  return cur < clockMinutes(MORNING_ENDS) ? 'morning' : 'day'
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
// Every reason is about TIME (picked for today, due soon). "High impact" is
// never a reason on its own: impact is often AI-inferred and says nothing about
// whether now is the moment.
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
  if (task.committed_on === todayKey) reasons.push('you picked it for today')
  if (due && due > todayKey && daysBetween(todayKey, due) <= NEXT_DUE_WINDOW_DAYS) reasons.push(dueLabel(due, todayKey))
  if (reasons.length && task.high_priority) reasons.push('marked high priority')
  if (reasons.length && ctx.weatherWindowActive && ctx.isOutdoor && ctx.isOutdoor(task)) reasons.push('good weather before it turns')
  return reasons
}

const reasonKey = (task) => [dueKey(task) || '', task.committed_on || '', task.high_priority ? 1 : 0].join('|')

// Did the user say this one matters (beyond giving it a date)?
const markedAsMattering = (t) => !!(t.high_priority || t.nag_allowed || t.remind_at || (t.escalation_current_rung > 0))

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
  const yesterdayKey = addDaysYmd(todayKey, -1)
  const ctx = { ...rankCtx, todayYmd: todayKey, nowMs }
  const rank = (t) => impactRank(t, ctx)
  const phase = dayPhase(routines, settings, now)
  const evening = phase === 'evening'

  const routineById = new Map(routines.map(r => [r.id, r]))
  const isStack = (r) => Array.isArray(r?.members) && r.members.length > 0
  const isRoutineTask = (t) => !!(t.routine_id && routineById.has(t.routine_id))
  // A plain loop credited outside its task (Loops → tap a day / Mark done
  // stamps the LOOP via stampLoopDay and leaves the task open) is done: Loops
  // says so, and Today follows the loop's record, not the leftover row. The
  // stamp has to be on or after the day this instance was created (back-filling
  // an older gap doesn't count); an auto-roll instance is one task rolled
  // forward daily, so for it only a stamp on its current due day counts.
  const loopCredited = (t) => {
    const r = t.routine_id ? routineById.get(t.routine_id) : null
    if (!r || isStack(r) || !Array.isArray(r.completed_history) || r.completed_history.length === 0) return false
    const created = t.created_at ? ymdOf(t.created_at) : null
    const due = dueKey(t)
    const from = r.auto_roll && due && due <= todayKey ? due : created
    if (!from) return false
    return r.completed_history.some(ts => Number.isFinite(ms(ts)) && ymdOf(ts) >= from)
  }
  const live = (t) => !t.parent_id && !t.gmail_pending && ACTIVE.includes(t.status) && !loopCredited(t)

  const evs = Array.isArray(events) ? events : []
  const nextCommitment = evs.find(e => e.busy && e.day === todayKey && e.startMs > nowMs) || null
  const quiet = inQuietHours(settings, now)
  const startOfToday = atClock(todayKey, '00:00')

  // Last night (creditYesterday.js) is bookkeeping about yesterday. It belongs
  // to the first part of the day; by the evening it is two days stale. While
  // it shows, the tasks it asks about appear nowhere else.
  // Waiting tasks are left out: asking "did you do it yesterday?" about
  // something that's on someone else is asking you to act on it.
  const lastNight = lastNightHidden || evening ? []
    : reconcileCandidates(tasks, now).filter(r => r.task.status !== 'waiting' && !(r.kind !== 'ticked' && loopCredited(r.task)))
  const lastNightIds = new Set(lastNight.map(r => r.task.id))

  // ── Classify every open, non-routine task once ──────────────────────────
  const attentionAll = []
  const slipped = []
  const waitingLong = []
  for (const t of tasks) {
    if (!live(t) || isRoutineTask(t) || snoozedAt(t, nowMs) || lastNightIds.has(t.id)) continue
    const due = dueKey(t)
    const remindMs = t.remind_at ? ms(t.remind_at) : null

    // Waiting on someone else: never "needs you". A long wait is a check-in.
    if (t.status === 'waiting') {
      // waiting_at is stamped when the status changes; older rows only have last_touched.
      const since = Number.isFinite(ms(t.waiting_at)) ? ms(t.waiting_at) : ms(t.last_touched)
      const days = Number.isFinite(since) ? Math.floor((nowMs - since) / 86400000) : null
      if (days != null && days >= WAITING_CHECKIN_DAYS) waitingLong.push({ task: t, days })
      continue
    }

    let reason = null
    if (isCrisis(t)) reason = { key: 'critical' }
    else if (remindMs != null && remindMs <= nowMs && remindMs >= startOfToday) reason = { key: 'reminder', at: remindMs }
    else if (due === todayKey) reason = { key: 'due' }
    else if (t.committed_on === todayKey && !due) reason = { key: 'committed' }
    else if (due === yesterdayKey && markedAsMattering(t)) reason = { key: 'recent' }
    if (reason) { attentionAll.push({ task: t, reason, rank: rank(t) }); continue }

    // Past its date (or an old reminder that went unanswered) without an
    // explicit signal: it slipped. That is a decision to make deliberately,
    // not an alarm.
    if ((due && due < todayKey) || (!due && remindMs != null && remindMs < startOfToday)) {
      slipped.push({ task: t, since: due || ymdOf(remindMs), days: daysBetween(due || ymdOf(remindMs), todayKey) })
    }
  }
  attentionAll.sort((a, b) => (ATTENTION_ORDER[a.reason.key] - ATTENTION_ORDER[b.reason.key]) || (b.rank - a.rank))
  const attentionIds = new Set(attentionAll.map(a => a.task.id))
  const attention = {
    items: attentionAll.slice(0, ATTENTION_LIMIT),
    overflow: Math.max(0, attentionAll.length - ATTENTION_LIMIT),
  }
  // Oldest first: the review is where long-forgotten things get a decision.
  slipped.sort((a, b) => a.since.localeCompare(b.since) || String(a.task.id).localeCompare(String(b.task.id)))
  waitingLong.sort((a, b) => b.days - a.days)
  const needsReview = { slipped, waiting: waitingLong, count: slipped.length + waitingLong.length }
  const reviewIds = new Set([...slipped, ...waitingLong].map(x => x.task.id))

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
      else if (!snoozedAt(t, nowMs) && !lastNightIds.has(t.id)) c.open.push(t)
    }
    const start = clockMinutes(r.trigger_time) != null ? atClock(todayKey, r.trigger_time) : atClock(todayKey, '00:00')
    const nextStart = stackTriggers.filter(s => s.id !== r.id && s.at > start).map(s => s.at)
    const windowEnd = Math.min(start + ROUTINE_WINDOW_HOURS * 3600000, ...nextStart)
    for (const c of [...byCycle.values()].filter(c => c.open.length > 0).sort((a, b) => a.due.localeCompare(b.due))) {
      let tier = 'full'
      let note = null
      if (c.due < todayKey) { tier = 'line'; note = c.due === yesterdayKey ? 'from yesterday' : 'from earlier' }
      else if (nowMs > windowEnd) { tier = 'line'; note = start < atClock(todayKey, '12:00') ? 'from this morning' : 'from earlier' }
      else if (leavingSoon) { tier = 'line'; note = `before ${nextCommitment.title}` }
      else if (!caughtRecently) { tier = 'line'; note = null }
      checklists.push({ routine: r, due: c.due, open: c.open, done: c.done, total: c.total, tier, note })
    }
  }
  checklists.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'full' ? -1 : 1))

  // Plain loops spawn ordinary tasks; the ones due today (or carried over) show
  // here, completed through the normal task path. An open instance with no due
  // date (older rows; the spawn pass always dates new ones) is the current cycle.
  const loopTasks = tasks.filter(t => live(t) && isRoutineTask(t) && !isStack(routineById.get(t.routine_id))
    && !snoozedAt(t, nowMs) && (!dueKey(t) || dueKey(t) <= todayKey) && !lastNightIds.has(t.id))
    .map(t => ({ task: t, routine: routineById.get(t.routine_id), overdueDays: dueKey(t) ? daysBetween(dueKey(t), todayKey) : 0 }))
    .sort((a, b) => b.overdueDays - a.overdueDays || rank(b.task) - rank(a.task))

  // ── Worth doing next ────────────────────────────────────────────────────
  // Only with a reason about time, and only if it fits what's known about the
  // time available. Never in the evening.
  let next = null
  let nextAbsent = null
  const dismissed = notNow && notNow.date === todayKey ? (notNow.entries || {}) : {}
  // The evening shows tonight and tomorrow; it doesn't push a task at you.
  if (evening) nextAbsent = 'evening'
  else if (quiet) nextAbsent = 'quiet'
  else if (Object.keys(dismissed).length >= NOT_NOW_MAX) nextAbsent = 'dismissed'
  else {
    const freeMin = nextCommitment ? Math.floor((nextCommitment.startMs - nowMs) / 60000) : null
    const daysOut = (t) => (dueKey(t) ? daysBetween(todayKey, dueKey(t)) : null)
    const pool = tasks
      .filter(t => !t.parent_id && !t.gmail_pending && PICKABLE.includes(t.status) && !snoozedAt(t, nowMs)
        && !t.routine_id && !attentionIds.has(t.id) && !reviewIds.has(t.id) && !lastNightIds.has(t.id)
        && !isCrisis(t) && dismissed[t.id] !== reasonKey(t))
      .filter(t => {
        const d = daysOut(t)
        const soon = d != null && d >= 1 && d <= NEXT_DUE_WINDOW_DAYS
        const picked = t.committed_on === todayKey
        return soon || picked
      })
      // Sooner first; picked-for-today next; impact only breaks ties.
      .map(t => ({ t, d: t.committed_on === todayKey ? 0 : daysOut(t), r: rank(t) }))
      .sort((a, b) => a.d - b.d || b.r - a.r || String(a.t.id).localeCompare(String(b.t.id)))
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

  // ── Later today / Tonight, and Tomorrow ─────────────────────────────────
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
    } else if (snoozedAt(t, nowMs) && ymdOf(t.snoozed_until) === todayKey
      && !(dueKey(t) && dueKey(t) < todayKey && !t.routine_id)) {
      // A slipped task coming back from snooze isn't "coming up": once back, it
      // lands in the review, so it isn't announced on the way there either.
      const at = ms(t.snoozed_until)
      if (r && isStack(r)) {
        const cur = stackLater.get(r.id)
        if (!cur) stackLater.set(r.id, { kind: 'checklist', at, routine: r, count: 1 })
        else { cur.count++; cur.at = Math.min(cur.at, at) }
      } else {
        // snoozed: this is a task you put off coming back, not a commitment.
        ahead.push({ kind: r ? 'loop' : 'returns', at, task: t, routine: r || null, snoozed: true })
      }
    }
  }
  ahead.push(...stackLater.values())
  ahead.sort((a, b) => a.at - b.at)

  const tmr = []
  for (const e of evs) {
    if (e.day !== tomorrowKey) continue
    tmr.push({ kind: 'event', at: e.allDay ? atClock(tomorrowKey, '00:00') : e.startMs, event: e, allDay: e.allDay })
  }
  for (const t of tasks) {
    if (!live(t) || attentionIds.has(t.id) || t.id === next?.task.id) continue
    if (t.remind_at && ymdOf(t.remind_at) === tomorrowKey) tmr.push({ kind: 'reminder', at: ms(t.remind_at), task: t })
    else if (dueKey(t) === tomorrowKey && !(t.routine_id && isStack(routineById.get(t.routine_id)))) {
      tmr.push({ kind: 'due', at: atClock(tomorrowKey, '23:59'), task: t })
    }
  }
  tmr.sort((a, b) => a.at - b.at)

  const later = { label: evening ? 'Tonight' : 'Coming up', day: todayKey, items: ahead.slice(0, COMING_LIMIT) }
  // Tomorrow always shows in the evening; in the day only once nothing is ahead.
  const tomorrow = { label: 'Tomorrow', day: tomorrowKey, items: (evening || ahead.length === 0) ? tmr.slice(0, COMING_LIMIT) : [] }

  // Later this week: the next few DATED things after tomorrow, only when nothing
  // nearer is on screen, so "what's next?" always has an answer when one exists.
  // Undated tasks never fill it. A waiting item is marked as waiting.
  const upcomingItems = []
  if (later.items.length === 0 && tomorrow.items.length === 0) {
    const firstDay = addDaysYmd(todayKey, 2)
    const lastDay = addDaysYmd(todayKey, UPCOMING_DAYS)
    const inRange = (k) => k && k >= firstDay && k <= lastDay
    for (const e of evs) {
      if (!inRange(e.day)) continue
      upcomingItems.push({ kind: 'event', at: e.allDay ? atClock(e.day, '00:00') : e.startMs, day: e.day, event: e, allDay: e.allDay })
    }
    for (const t of tasks) {
      if (!live(t) || t.routine_id || attentionIds.has(t.id) || t.id === next?.task.id) continue
      const remindKey = t.remind_at ? ymdOf(t.remind_at) : null
      if (inRange(remindKey)) upcomingItems.push({ kind: 'reminder', at: ms(t.remind_at), day: remindKey, task: t, waiting: t.status === 'waiting' })
      else if (inRange(dueKey(t))) upcomingItems.push({ kind: 'due', at: atClock(dueKey(t), '23:59'), day: dueKey(t), task: t, waiting: t.status === 'waiting' })
    }
    upcomingItems.sort((a, b) => a.at - b.at)
  }
  const upcoming = { label: 'Later this week', items: upcomingItems.slice(0, UPCOMING_LIMIT) }

  // ── Review, the quiet extras ────────────────────────────────────────────
  const pending = tasks.filter(t => t.gmail_pending)
  const review = {
    count: pending.length,
    source: pending.length && pending.every(t => t.gmail_message_id) ? 'Gmail'
      : pending.length && pending.every(t => t.notion_page_id) ? 'Notion' : null,
    items: pending,
  }

  const pinnedArcs = tasks.filter(t => t.status === 'project' && t.pinned_to_today).map(p => ({
    arc: p,
    children: tasks.filter(t => t.parent_id === p.id && t.child_visibility === 'active'
      && ACTIVE.includes(t.status) && !snoozedAt(t, nowMs)),
  }))

  const fullChecklists = checklists.some(c => c.tier === 'full')
  // "Nothing needs you" is about the main path. Slipped items, suggestions and
  // Last night are bookkeeping rows and don't make the day feel unfinished.
  const allClear = attention.items.length === 0 && !fullChecklists && loopTasks.length === 0 && !next

  // The order of the screen. Main path first; bookkeeping rows ('quiet') last.
  // What the subtitle should say: the state the screen is actually in.
  const headline = attention.items.length > 0 ? (evening ? 'evening' : 'attention')
    : evening ? (allClear ? 'evening-clear' : 'evening')
      : next ? 'next'
        : allClear ? 'clear' : 'quiet'

  // In the evening, unfinished routines sit with the checklists: "is there a
  // routine I haven't finished?" is one of the evening's questions.
  const order = evening
    ? ['attention', 'checklists', 'loops', 'later', 'tomorrow', 'upcoming', 'arcs', 'quiet']
    : ['attention', 'next', 'later', 'checklists', 'loops', 'tomorrow', 'upcoming', 'arcs', 'quiet']

  return {
    todayKey, tomorrowKey, nowMs, quiet, phase, order, headline,
    attention, needsReview, checklists, loopTasks, next, nextAbsent, nextCommitment,
    later, tomorrow, upcoming, review, lastNight, pinnedArcs, allClear,
  }
}

// ── Not now (per device, per day) ──────────────────────────────────────────
// The record is cosmetic: the task is never touched. Same idea and lifetime as
// the Last night "Not now" (boom_lastnight_hidden_on).
export function recordNotNow(state, todayKey, taskId, key) {
  const base = state && state.date === todayKey ? state : { date: todayKey, entries: {} }
  return { date: todayKey, entries: { ...base.entries, [taskId]: key } }
}
