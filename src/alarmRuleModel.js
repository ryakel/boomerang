// Pure rules for the alarm interface (BOOM-51): what state an alarm is in,
// which occurrences one arming covers, and how to say when it rings. No
// network, no native bridge, no clock reads (`now` is always an argument), so
// scripts/alarmRuleModel.test.mjs can pin every rule.
//
// Facts this leans on (server/alarmSchedule.js, BoomerangAlarmRules.swift):
// - The server plans each rule up to 28 days ahead.
// - Arming sends the phone its WHOLE plan; anything left out is cancelled.
// - The phone takes at most 16 occurrences at once, so one arming covers the
//   next 16 in time order. A five-day-a-week alarm fills that in about three
//   weeks, which is why the card says how far an arming reaches.
// - The phone reports each armed cue's key, target and state, but not its lead
//   or snooze, so a settings-only edit is caught by the armed revision.
import { dateInZone } from '../server/alarmSchedule.js'

export const MAX_ARMED = 16
// Arriving as done (BOOM-53): an arrival counts from this many minutes before
// to this many after that day's alarm (owner, 2026-11-21). The phone enforces
// it (ArrivalMonitor.window in BoomerangAlarmRules.swift); this is for saying so.
export const ARRIVAL_WINDOW_MINUTES = 60
export const RENEW_WITHIN_DAYS = 5
const LIVE = ['scheduled', 'countdown', 'paused', 'alerting']
const WEEK = [1, 2, 3, 4, 5, 6, 0] // Monday first, the way the app's calendars read
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// What each state is called, on the card's badge and in Settings.
export const STATUS_LABEL = {
  'not-armed': 'Not armed yet', changes: 'Changes waiting', armed: 'Armed on this phone', off: 'Off',
  'held-reminder': 'On hold', 'held-inactive': 'On hold', 'nothing-upcoming': 'Nothing set', 'other-phone': 'On another phone',
}

export function blankAlarmRule(sourceKind, sourceId, timeZone) {
  return { sourceKind, sourceId, enabled: true, timeZone, weekly: [], dates: [], leadMinutes: 5, snoozeMinutes: 5, ackLabel: 'Done', arrival: null }
}

// Only the fields the server validates; snapshot extras (title, plans, held
// dates) never ride back on a save.
export function ruleFields(rule) {
  const { sourceKind, sourceId, enabled, timeZone, weekly, dates, leadMinutes, snoozeMinutes, ackLabel, arrival = null } = rule
  return { sourceKind, sourceId, enabled, timeZone, weekly, dates, leadMinutes, snoozeMinutes, ackLabel, arrival }
}

export function clock12(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

// Display helpers. `timeIn` formats an instant in the rule's own timezone so a
// phone travelling elsewhere still shows the clock the alarm was set in.
export const shortDate = (ymd) => ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
export const dayDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const timeIn = (ms, timeZone) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })

const epoch = (iso) => Math.round(Date.parse(iso) / 1000)
const short = (date) => shortDate(date)
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

// "Mon · Tue · Thu · Fri 2:00 PM" and "Wed 1:30 PM": days grouped by time.
export function ringsSummary(rule) {
  const byTime = new Map()
  for (const day of WEEK) {
    const row = (rule?.weekly || []).find(x => x.weekday === day)
    if (!row) continue
    if (!byTime.has(row.time)) byTime.set(row.time, [])
    byTime.get(row.time).push(day)
  }
  return [...byTime.entries()]
    .sort((a, b) => WEEK.indexOf(a[1][0]) - WEEK.indexOf(b[1][0]))
    .map(([time, days]) => {
      const label = days.length === 7 ? 'Every day'
        : days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d)) ? 'Weekdays'
          : days.length === 2 && days.includes(0) && days.includes(6) ? 'Weekends'
            : days.map(d => DAY_SHORT[d]).join(' · ')
      return `${label} ${clock12(time)}`
    })
}

// Upcoming one-off changes, from today on. Consecutive skipped days collapse
// to one range ("Nov 26 – 27"); an extra day reads "Dec 3 at 3:00 PM".
export function oneOffSummary(rule, todayKey) {
  const future = (rule?.dates || []).filter(x => x.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date))
  const skips = []
  for (const x of future.filter(d => d.time === null)) {
    const last = skips[skips.length - 1]
    if (last && dayDiff(last.end, x.date) === 1) last.end = x.date
    else skips.push({ start: x.date, end: x.date })
  }
  return {
    skips: skips.map(r => r.start === r.end ? short(r.start)
      : r.start.slice(0, 7) === r.end.slice(0, 7) ? `${short(r.start)} – ${Number(r.end.slice(8))}` : `${short(r.start)} – ${short(r.end)}`),
    extras: future.filter(d => d.time !== null).map(d => `${short(d.date)} at ${clock12(d.time)}`),
  }
}

// One arming: this phone's owned occurrences in time order, capped at what the
// phone accepts. `through` is the last date it reaches.
export function armWindow(state, deviceId, max = MAX_ARMED) {
  const owned = new Set((state?.rules || []).filter(r => r.deviceId === deviceId).map(r => r.id))
  const all = (state?.plans || []).filter(p => owned.has(p.ruleId)).flatMap(p => p.occurrences)
    .sort((a, b) => Date.parse(a.target) - Date.parse(b.target))
  const items = all.slice(0, max)
  return { items, total: all.length, truncated: all.length > max, through: items.length ? items[items.length - 1].date : null }
}

const liveTargets = (native, ruleId, nowMs) => (native?.cues || [])
  .filter(c => c.ruleId === ruleId && !c.earlyCue && LIVE.includes(c.state) && c.target * 1000 > nowMs)

// The card's state for one rule:
//   none | other-phone | off | held-reminder | held-inactive | nothing-upcoming
//   | not-armed | changes | armed
// plus how far it is armed and whether a renewal prompt is due.
export function alarmCardStatus({ rule, state, native, armedRevision = null, now }) {
  if (!rule) return { status: 'none' }
  if (native?.deviceId && rule.deviceId !== native.deviceId) return { status: 'other-phone' }
  if (!rule.enabled) return { status: 'off' }
  if (rule.conflict) return { status: 'held-reminder' }
  if (!rule.available) return { status: 'held-inactive' }
  const todayKey = dateInZone(now, rule.timeZone)
  const plan = (state?.plans || []).find(p => p.ruleId === rule.id)?.occurrences || []
  const window = armWindow(state, rule.deviceId).items.filter(o => o.ruleId === rule.id)
  const armed = liveTargets(native, rule.id, now)
  const reach = armWindow(state, rule.deviceId)
  // How far the next arming would reach for this rule, and whether the phone's
  // 16-alarm limit cuts it short of the 28-day plan.
  const armsThrough = window.length ? window[window.length - 1].date : null
  const capped = reach.truncated && plan.length > window.length
  if (!armed.length) return { status: plan.length ? 'not-armed' : 'nothing-upcoming', next: (window.length ? window : plan).slice(0, 3), armsThrough, capped }
  const armedThrough = armed.map(c => c.date).sort().pop()
  // Only compare what this arming was meant to cover. As days pass, the window
  // slides forward and new dates enter it; that is a renewal, not a change.
  const want = new Set(window.filter(o => o.date <= armedThrough).map(o => `${o.key}@${epoch(o.target)}`))
  const have = new Set(armed.map(c => `${c.key}@${Math.round(c.target)}`))
  const same = want.size === have.size && [...want].every(k => have.has(k))
  const settings = armedRevision != null && armedRevision !== rule.revision
  const changed = !same || settings
  const more = plan.some(o => o.date > armedThrough)
  const renewSoon = !changed && more && dayDiff(todayKey, armedThrough) <= RENEW_WITHIN_DAYS
  return { status: changed ? 'changes' : 'armed', armedThrough, renewSoon, next: window.slice(0, 3), armsThrough, capped,
    why: changed ? changesWhy({ window, armed, armedThrough, native, settings, sameTimes: same }) : null }
}

// What "Changes waiting" is actually about (BOOM-56). The card used to say only
// that something differed, which left a stuck state undiagnosable from the
// phone. Each missing day carries the phone's own state for it: "cancelled"
// after an arming means the phone skipped it.
function changesWhy({ window, armed, armedThrough, native, settings, sameTimes }) {
  const want = new Map(window.filter(o => o.date <= armedThrough).map(o => [o.key, o]))
  const have = new Map(armed.map(c => [c.key, c]))
  const doneOnPhone = new Set([...(native?.receipts || []), ...(native?.arrivals || [])].map(r => r.key))
  const phoneState = (key) => doneOnPhone.has(key) ? 'marked done' : (native?.cues || []).find(c => c.key === key && !c.earlyCue)?.state || 'absent'
  const missing = [...want.values()].filter(o => !have.has(o.key)).map(o => ({ date: o.date, state: phoneState(o.key) }))
  const moved = [...want.values()].filter(o => have.has(o.key) && epoch(o.target) !== Math.round(have.get(o.key).target)).map(o => o.date)
  const extra = [...have.values()].filter(c => !want.has(c.key)).map(c => c.date)
  return { missing, moved, extra, settings: settings && sameTimes }
}

// One plain line for the card from changesWhy().
export function changesWhyText(why) {
  if (!why) return null
  const days = (list) => list.slice(0, 4).map(d => shortDate(d)).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '')
  const parts = []
  if (why.missing.length) {
    const states = [...new Set(why.missing.map(m => m.state))].join('/')
    parts.push(`The phone doesn’t have ${days(why.missing.map(m => m.date))} (${states} on the phone).`)
  }
  if (why.moved.length) parts.push(`Times differ on ${days(why.moved)}.`)
  if (why.extra.length) parts.push(`The phone still has ${days(why.extra)}, which you removed.`)
  if (why.settings) parts.push('The warning, snooze or done-button text changed since arming.')
  return parts.join(' ') || null
}

// Today's armed alarms on this phone that are still open, plus the ones
// already acknowledged today (so Today can say "Leaving now at 1:52 PM").
export function todayAlarms({ state, native, now }) {
  const receipts = new Map((native?.receipts || []).map(r => [r.key, r]))
  // An arrival (BOOM-53) is a done-for-the-day too, and it wins the wording:
  // "Arrived at School at 2:14" says more than "Leaving now at 1:58".
  const arrivals = new Map((native?.arrivals || []).map(r => [r.key, r]))
  const acks = state?.acknowledgments || {}
  const plans = new Map((state?.plans || []).flatMap(p => p.occurrences).map(o => [o.key, o]))
  const seen = new Map()
  const at = (x) => typeof x.recordedAt === 'number' ? x.recordedAt * 1000 : Date.parse(x.recordedAt)
  for (const c of native?.cues || []) {
    if (c.earlyCue || !c.timeZone || c.date !== dateInZone(now, c.timeZone)) continue
    if (!LIVE.includes(c.state) && !receipts.has(c.key) && !acks[c.key] && !arrivals.has(c.key)) continue
    if (seen.has(c.key)) continue
    const done = arrivals.get(c.key) || receipts.get(c.key) || acks[c.key]
    seen.set(c.key, {
      key: c.key, ruleId: c.ruleId, title: c.title, ackLabel: c.ackLabel, target: c.target * 1000,
      early: plans.get(c.key)?.earlyPending ? Date.parse(plans.get(c.key).early) : null,
      ringing: c.state === 'alerting' || c.state === 'countdown',
      doneAt: done ? at(done) : null,
      doneLabel: done ? (done.label || c.ackLabel) : null,
      arrived: arrivals.has(c.key),
    })
  }
  // A receipt or arrival for today whose cue has dropped out of the readback
  // still reads as done: it happened, the line shouldn't vanish.
  for (const r of [...(native?.arrivals || []), ...(native?.receipts || [])]) {
    if (seen.has(r.key)) continue
    const rule = (state?.rules || []).find(x => x.id === r.ruleId)
    if (!rule || r.date !== dateInZone(now, rule.timeZone)) continue
    seen.set(r.key, { key: r.key, ruleId: r.ruleId, title: rule.title, ackLabel: r.label, target: null, early: null, ringing: false, doneAt: at(r), doneLabel: r.label, arrived: arrivals.has(r.key) })
  }
  return [...seen.values()].sort((a, b) => (a.target ?? a.doneAt) - (b.target ?? b.doneAt))
}

// The window an arrival counts in, for one alarm target: { from, to } in ms.
export function arrivalWindow(targetMs) {
  return { from: targetMs - ARRIVAL_WINDOW_MINUTES * 60000, to: targetMs + ARRIVAL_WINDOW_MINUTES * 60000 }
}

// Where the arrival row stands, from the rule and the phone's location status:
//   off | needs-place | needs-always | denied | unavailable | ready
// "ready" means on, placed, and allowed to wake in the background.
export function arrivalState(rule, location) {
  const a = rule?.arrival
  if (!a || !a.enabled) return a ? 'off' : 'needs-place'
  if (!location?.available) return 'unavailable'
  if (location.authorization === 'denied' || location.authorization === 'restricted') return 'denied'
  if (location.authorization !== 'always') return 'needs-always'
  if (location.monitoring === false) return 'unavailable'
  return 'ready'
}

