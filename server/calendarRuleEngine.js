// Calendar event rules — the half that touches the world.
//
// Fetches events, decides what fired, writes tasks. Every judgement about
// whether an event matches lives in calendarRules.js, which is pure; this file
// only ever asks it. Modelled on gmailSync.js: init with deps, poll on an
// interval, broadcast when something changed.

import {
  listGCalRules, getGCalRule, getGCalRuleFires, markGCalRuleFired,
  upsertTask, bumpVersion, getData,
} from './db.js'
import { matchEvent, buildTaskFromRule, eventIsUpcoming } from './calendarRules.js'
import { ymdInTz, DEFAULT_TIMEZONE } from './taskModel.js'

// Same horizon the pull sync uses, so a rule and an import see the same
// calendar and nobody has to reason about two windows.
const WINDOW_DAYS = 30

let deps = {
  listEvents: null,   // (calendarId, timeMin, timeMax) -> events[]  (throws)
  isConnected: null,  // () -> boolean
  broadcast: null,    // (version, sourceClientId) -> void
}
let pollTimer = null
let running = false

export function initCalendarRules(opts = {}) {
  deps = { ...deps, ...opts }
}

function windowRange(now = new Date()) {
  const end = new Date(now)
  end.setDate(end.getDate() + WINDOW_DAYS)
  return { timeMin: now.toISOString(), timeMax: end.toISOString() }
}

function calendarFor(rule) {
  return rule.calendar_id || (getData('settings') || {}).gcal_calendar_id || 'primary'
}

function newTaskId() {
  return `gcalrule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// The clock, read once per pass so every event in one run is judged against the
// same instant. todayYmd is what an all-day event compares against — it has no
// instant of its own, only a date.
function readClock() {
  const tz = (getData('settings') || {}).user_timezone || DEFAULT_TIMEZONE
  const now = new Date()
  return { now: now.toISOString(), todayYmd: ymdInTz(now, tz) }
}

// Would this rule actually produce a task for this event right now?
//
// Separate from matchEvent() on purpose. Matching answers "does this rule claim
// events like this?" and has no clock, because the suppression query depends on
// that answer staying stable; firing answers "and should it act on this one,
// now?". A future_only rule still SUPPRESSES an event it won't fire on, which
// is what stops a flight appearing in the list halfway through itself.
function firesOn(rule, event, clock) {
  if (!rule.future_only) return true
  return eventIsUpcoming(event, clock)
}

// One fetch per distinct calendar, shared by every rule pointed at it.
//
// A calendar whose fetch FAILED is absent from the returned map, never present
// as []. The distinction is the whole point: an empty array is a real answer
// ("nothing on the calendar"), and treating a failure as one would make
// baselineRule() baseline nothing and then fire everything on the next poll.
async function fetchCalendars(rules, range) {
  const byCalendar = new Map()
  for (const rule of rules) {
    const cal = calendarFor(rule)
    if (byCalendar.has(cal)) continue
    try {
      byCalendar.set(cal, await deps.listEvents(cal, range.timeMin, range.timeMax))
    } catch (err) {
      console.error(`[CalRules] could not read calendar ${cal}: ${err.message}`)
    }
  }
  return byCalendar
}

function createTaskFor(rule, event, captures) {
  const task = buildTaskFromRule(rule, event, {
    id: newTaskId(),
    now: new Date().toISOString(),
    captures,
  })
  upsertTask(task)
  return task
}

// --- the poll --------------------------------------------------------------

export async function runCalendarRules(reason = 'scheduled') {
  if (running) return { skipped: 'already running' }
  if (!deps.listEvents) return { skipped: 'not initialized' }
  if (deps.isConnected && !deps.isConnected()) return { skipped: 'calendar not connected' }

  const rules = listGCalRules().filter(r => r.enabled)
  if (rules.length === 0) return { skipped: 'no enabled rules' }

  running = true
  try {
    const byCalendar = await fetchCalendars(rules, windowRange())
    const clock = readClock()
    let created = 0

    for (const rule of rules) {
      const events = byCalendar.get(calendarFor(rule))
      if (!events) continue // fetch failed for this calendar — try again next poll
      const fires = getGCalRuleFires(rule.id)
      for (const event of events) {
        // Keyed on the INSTANCE id: a weekly flight is a weekly budget update.
        if (fires.has(event.id)) continue
        const { matched, captures } = matchEvent(rule, event)
        if (!matched) continue
        // Left unrecorded rather than baselined: time only moves forward, so a
        // past event can never become fireable, and an event MOVED into the
        // future should fire when it gets there.
        if (!firesOn(rule, event, clock)) continue
        const task = createTaskFor(rule, event, captures)
        markGCalRuleFired(rule.id, event.id, task.id, event.summary || null)
        created++
        console.log(`[CalRules] "${rule.name}" fired on "${event.summary}" → "${task.title}"${task.due_date ? ` (due ${task.due_date})` : ''}`)
      }
    }

    if (created > 0) {
      const version = bumpVersion()
      deps.broadcast?.(version, null)
    }
    if (created > 0 || reason === 'manual') {
      console.log(`[CalRules] ${reason} run: ${created} task(s) created from ${rules.length} rule(s)`)
    }
    return { created, rules: rules.length }
  } finally {
    running = false
  }
}

export function startCalendarRulePolling(intervalMs = 15 * 60 * 1000) {
  stopCalendarRulePolling()
  // Ticks unconditionally and bails cheaply when there is nothing to do, so a
  // rule added at runtime starts working without a restart.
  pollTimer = setInterval(() => {
    runCalendarRules('scheduled').catch(err => console.error('[CalRules] poll failed:', err.message))
  }, intervalMs)
  setTimeout(() => {
    runCalendarRules('boot').catch(err => console.error('[CalRules] boot run failed:', err.message))
  }, 15000)
  console.log(`[CalRules] polling every ${Math.round(intervalMs / 60000)}m`)
}

export function stopCalendarRulePolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

// --- saving a rule ---------------------------------------------------------

// Stamp every event the rule matches RIGHT NOW as already-fired, without
// creating anything. Saving a rule must never backfill: a slightly-too-broad
// rule would otherwise empty a month of calendar into Today on its first poll,
// and the first thing anyone does with a new rule is get it slightly wrong.
//
// Throws if the calendar could not be read. Baselining against a failed fetch
// would baseline zero events and hand the next poll the very flood this exists
// to prevent — the "empty is not the same as failed" rule, again.
export async function baselineRule(rule) {
  if (!rule?.enabled) return 0
  if (!deps.listEvents) throw new Error('Calendar rules not initialized')
  const range = windowRange()
  const events = await deps.listEvents(calendarFor(rule), range.timeMin, range.timeMax)
  if (!Array.isArray(events)) throw new Error('Calendar returned no usable event list')

  let baselined = 0
  const clock = readClock()
  const fires = getGCalRuleFires(rule.id)
  for (const event of events) {
    if (fires.has(event.id)) continue
    if (!matchEvent(rule, event).matched) continue
    // Don't reserve what can never fire — otherwise "Apply to 12 existing"
    // promises tasks a future_only rule would then refuse to create.
    if (!firesOn(rule, event, clock)) continue
    markGCalRuleFired(rule.id, event.id, null, event.summary || null)
    baselined++
  }
  if (baselined > 0) console.log(`[CalRules] "${rule.name}" baselined ${baselined} existing event(s) — no tasks created`)
  return baselined
}

// --- the tester ------------------------------------------------------------

// What this rule would do, without doing any of it. Marks nothing.
export async function previewRule(rule) {
  if (!deps.listEvents) throw new Error('Calendar rules not initialized')
  const range = windowRange()
  const events = await deps.listEvents(calendarFor(rule), range.timeMin, range.timeMax)
  const fires = rule.id ? getGCalRuleFires(rule.id) : new Map()

  const clock = readClock()
  const matches = []
  for (const event of events || []) {
    const { matched, captures } = matchEvent(rule, event)
    if (!matched) continue
    const task = buildTaskFromRule(rule, event, { id: 'preview', now: clock.now, captures })
    matches.push({
      event_id: event.id,
      event_title: event.summary || '(untitled)',
      event_date: event.start?.date || event.start?.dateTime || null,
      already_fired: fires.get(event.id) != null,
      pending: fires.has(event.id) && fires.get(event.id) == null,
      // Reported rather than filtered out: a rule that silently drops a match
      // leaves "why didn't it fire on that one?" with no answer anywhere.
      withheld_as_past: !firesOn(rule, event, clock),
      task: { title: task.title, due_date: task.due_date, notes: task.notes },
    })
  }
  return { window_days: WINDOW_DAYS, scanned: (events || []).length, matches }
}

// --- applying to what is already on the calendar ---------------------------

// The explicit follow-up to baselining: create tasks for the events the rule
// matched when it was saved. Only touches rows the baseline is holding
// (task_id NULL) — events the poll has already handled are left alone.
export async function applyRuleToExisting(ruleId) {
  const rule = getGCalRule(ruleId)
  if (!rule) throw new Error('Rule not found')
  if (!deps.listEvents) throw new Error('Calendar rules not initialized')

  const range = windowRange()
  const events = await deps.listEvents(calendarFor(rule), range.timeMin, range.timeMax)
  const fires = getGCalRuleFires(rule.id)

  const clock = readClock()
  let created = 0
  for (const event of events || []) {
    if (!fires.has(event.id) || fires.get(event.id) != null) continue
    const { matched, captures } = matchEvent(rule, event)
    if (!matched) continue
    if (!firesOn(rule, event, clock)) continue
    const task = createTaskFor(rule, event, captures)
    markGCalRuleFired(rule.id, event.id, task.id, event.summary || null)
    created++
  }
  if (created > 0) {
    const version = bumpVersion()
    deps.broadcast?.(version, null)
    console.log(`[CalRules] "${rule.name}" applied to ${created} existing event(s)`)
  }
  return { created }
}

// --- suppression -----------------------------------------------------------

// Which of these events a suppressing rule claims, so the pull sync doesn't
// ALSO import them as tasks of themselves.
//
// This is a QUERY over the rules, not a lookup in the fire ledger, and that is
// deliberate. The poller and the client pull run on different clocks: open the
// app a minute before the poll fires and a ledger-based answer would say "not
// suppressed" and import the flight anyway. Evaluated against the rules, the
// answer is the same whichever runs first — which is the only version of this
// that is actually race-free.
export function suppressedEventIds(events = []) {
  const rules = listGCalRules().filter(r => r.enabled && r.suppress_event_import)
  if (rules.length === 0) return []
  const out = []
  for (const event of events) {
    if (rules.some(rule => matchEvent(rule, event).matched)) out.push(event.id)
  }
  return out
}
