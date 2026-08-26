import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchEvent, renderTemplate, buildTaskFromRule, normalizeRule,
  eventDate, eventTime, shiftDate, rulesMatching, eventIsUpcoming, soonestDueDate,
  groupConditions, evaluateCondition,
} from '../server/calendarRules.js'

// The event from the screenshot that started this feature.
const flight = (o = {}) => ({
  id: 'evt-flight-1',
  summary: 'Ryan Kelch in N5274S with Marty Kemp',
  location: "Hap's Air Service 2508 Airport Dr, Ames, IA, 50010",
  description: 'Tap here to update your reservation',
  start: { dateTime: '2026-08-25T09:00:00-05:00' },
  end: { dateTime: '2026-08-25T11:00:00-05:00' },
  ...o,
})

const rule = (o = {}) => ({
  id: 'r1',
  name: 'Flight → update budget',
  enabled: true,
  calendar_id: null,
  conditions: [{ field: 'title', op: 'matches', value: 'N(\\d{4}[A-Z])' }],
  template: { title: 'Update the flight budget spreadsheet', due_offset_days: 1 },
  suppress_event_import: false,
  ...o,
})

// --- matching --------------------------------------------------------------

test('the flight event matches a tail-number rule', () => {
  const m = matchEvent(rule(), flight())
  assert.equal(m.matched, true)
  assert.deepEqual(m.captures, ['5274S'], 'the capture group is available to the template')
})

test('an event with no tail number does not match', () => {
  assert.equal(matchEvent(rule(), flight({ summary: 'Dentist' })).matched, false)
})

test('conditions are ANDed — one miss is a miss', () => {
  const r = rule({
    conditions: [
      { field: 'title', op: 'matches', value: 'N\\d{4}[A-Z]' },
      { field: 'location', op: 'contains', value: 'Des Moines' },
    ],
  })
  assert.equal(matchEvent(r, flight()).matched, false)
})

test('contains and equals are case-insensitive', () => {
  const r = rule({ conditions: [{ field: 'location', op: 'contains', value: "hap's air service" }] })
  assert.equal(matchEvent(r, flight()).matched, true)
})

test('not_contains keeps an otherwise-matching event out', () => {
  const r = rule({
    conditions: [
      { field: 'title', op: 'matches', value: 'N\\d{4}[A-Z]' },
      { field: 'title', op: 'not_contains', value: 'CANCELLED' },
    ],
  })
  assert.equal(matchEvent(r, flight()).matched, true)
  assert.equal(matchEvent(r, flight({ summary: 'CANCELLED — Ryan Kelch in N5274S' })).matched, false)
})

test('timing distinguishes all-day from timed events', () => {
  const allDay = rule({ conditions: [{ field: 'timing', op: 'is', value: 'all_day' }] })
  const timed = rule({ conditions: [{ field: 'timing', op: 'is', value: 'timed' }] })
  assert.equal(matchEvent(allDay, flight()).matched, false)
  assert.equal(matchEvent(timed, flight()).matched, true)
  assert.equal(matchEvent(allDay, flight({ start: { date: '2026-08-25' } })).matched, true)
})

test('attendees and organizer are matchable', () => {
  const e = flight({
    attendees: [{ email: 'marty@example.com', displayName: 'Marty Kemp' }],
    organizer: { email: 'scheduler@hapsair.example' },
  })
  assert.equal(matchEvent(rule({ conditions: [{ field: 'attendees', op: 'contains', value: 'marty@' }] }), e).matched, true)
  assert.equal(matchEvent(rule({ conditions: [{ field: 'organizer', op: 'contains', value: 'hapsair' }] }), e).matched, true)
})

test('a disabled rule never matches', () => {
  assert.equal(matchEvent(rule({ enabled: false }), flight()).matched, false)
})

test('a cancelled event never matches — a cancelled instance is not a flight', () => {
  assert.equal(matchEvent(rule(), flight({ status: 'cancelled' })).matched, false)
})

test('a rule with no conditions matches nothing rather than everything', () => {
  assert.equal(matchEvent(rule({ conditions: [] }), flight()).matched, false)
})

test('an uncompilable pattern fails closed', () => {
  // Can only arrive here by hand-editing the db — normalizeRule rejects it on
  // the way in — but firing on every event because a regex broke is the one
  // outcome worse than not firing at all.
  const r = rule({ conditions: [{ field: 'title', op: 'matches', value: 'N(\\d{4}' }] })
  assert.equal(matchEvent(r, flight()).matched, false)
})

test('a rule pinned to one calendar ignores events from another', () => {
  const r = rule({ calendar_id: 'work@example.com' })
  assert.equal(matchEvent(r, flight({ calendarId: 'personal@example.com' })).matched, false)
  assert.equal(matchEvent(r, flight({ calendarId: 'work@example.com' })).matched, true)
})

// --- templating ------------------------------------------------------------

test('placeholders render from the event', () => {
  const out = renderTemplate('Flight {{event.title}} on {{event.date}} at {{event.time}}', flight())
  assert.equal(out, 'Flight Ryan Kelch in N5274S with Marty Kemp on 2026-08-25 at 09:00')
})

test('capture groups render by position', () => {
  const { captures } = matchEvent(rule(), flight())
  assert.equal(renderTemplate('Log {{match.1}} hours', flight(), captures), 'Log 5274S hours')
})

test('an unknown placeholder renders empty rather than printing itself', () => {
  assert.equal(renderTemplate('Log {{event.tail}} hours', flight()), 'Log  hours'.trim())
})

// --- the task that comes out -----------------------------------------------

test('the built task is due the day after the flight', () => {
  const { captures } = matchEvent(rule(), flight())
  const task = buildTaskFromRule(rule(), flight(), { id: 't1', now: '2026-08-20T00:00:00Z', captures })
  assert.equal(task.title, 'Update the flight budget spreadsheet')
  assert.equal(task.due_date, '2026-08-26')
  assert.equal(task.status, 'not_started')
  assert.equal(task.capture_source, 'gcal_rule')
})

test('the built task NEVER carries gcal_event_id — completing it must not delete the flight', () => {
  const task = buildTaskFromRule(rule(), flight(), { id: 't1', now: '2026-08-20T00:00:00Z' })
  assert.equal(task.gcal_event_id, undefined)
})

test('no offset means no due date', () => {
  const r = rule({ template: { title: 'Something' } })
  assert.equal(buildTaskFromRule(r, flight(), { id: 't1', now: 'now' }).due_date, null)
})

test('a negative offset lands before the event', () => {
  const r = rule({ template: { title: 'Pre-flight check', due_offset_days: -1 } })
  assert.equal(buildTaskFromRule(r, flight(), { id: 't1', now: 'now' }).due_date, '2026-08-24')
})

test('a title that renders empty falls back rather than producing an untitled task', () => {
  const r = rule({
    conditions: [{ field: 'title', op: 'matches', value: 'N\\d{4}[A-Z]' }], // no groups
    template: { title: '{{match.1}}' },
  })
  const { captures } = matchEvent(r, flight())
  const task = buildTaskFromRule(r, flight(), { id: 't1', now: 'now', captures })
  assert.equal(task.title, 'Ryan Kelch in N5274S with Marty Kemp')
})

// --- date arithmetic -------------------------------------------------------

test('the event date is read in the event\'s own offset, like the pull sync', () => {
  assert.equal(eventDate(flight()), '2026-08-25')
  assert.equal(eventTime(flight()), '09:00')
  assert.equal(eventDate(flight({ start: { date: '2026-08-25' } })), '2026-08-25')
  assert.equal(eventTime(flight({ start: { date: '2026-08-25' } })), null)
})

test('shiftDate crosses month and year boundaries', () => {
  assert.equal(shiftDate('2026-08-31', 1), '2026-09-01')
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftDate('2026-02-28', 1), '2026-03-01')
})

// --- validation ------------------------------------------------------------

test('a rule with no conditions is rejected at save time', () => {
  assert.throws(() => normalizeRule({ name: 'x', conditions: [], template: { title: 'y' } }), /at least one condition/)
})

test('an invalid regex is rejected at save time with a readable message', () => {
  assert.throws(
    () => normalizeRule({ name: 'x', conditions: [{ field: 'title', op: 'matches', value: 'N(\\d{4}' }], template: { title: 'y' } }),
    /not a valid regular expression/,
  )
})

test('a rule with no task title is rejected', () => {
  assert.throws(() => normalizeRule({ name: 'x', conditions: [{ field: 'title', op: 'contains', value: 'a' }], template: {} }), /task title/)
})

test('normalizing fills the template defaults', () => {
  const r = normalizeRule({
    name: '  Flight  ',
    conditions: [{ field: 'title', op: 'contains', value: 'N5274S' }],
    template: { title: 'Update budget', tags: ['aviation', ''], size: 'm' },
  })
  assert.equal(r.name, 'Flight')
  assert.equal(r.enabled, true)
  assert.deepEqual(r.template.tags, ['aviation'])
  assert.equal(r.template.size, 'M')
  assert.equal(r.template.due_offset_days, null)
  assert.equal(r.suppress_event_import, false)
})

test('a fractional or absurd due offset is rejected', () => {
  const base = { name: 'x', conditions: [{ field: 'title', op: 'contains', value: 'a' }] }
  assert.throws(() => normalizeRule({ ...base, template: { title: 'y', due_offset_days: 1.5 } }), /whole number/)
  assert.throws(() => normalizeRule({ ...base, template: { title: 'y', due_offset_days: 9999 } }), /whole number/)
})

test('timing conditions only accept the "is" operator and known values', () => {
  const base = { name: 'x', template: { title: 'y' } }
  assert.throws(() => normalizeRule({ ...base, conditions: [{ field: 'timing', op: 'contains', value: 'timed' }] }), /only supports/)
  assert.throws(() => normalizeRule({ ...base, conditions: [{ field: 'timing', op: 'is', value: 'sometimes' }] }), /all_day or timed/)
})

// --- the collection view ---------------------------------------------------

test('rulesMatching returns every matching rule with its own captures', () => {
  const rules = [
    rule({ id: 'a' }),
    rule({ id: 'b', conditions: [{ field: 'location', op: 'contains', value: 'Ames' }] }),
    rule({ id: 'c', conditions: [{ field: 'title', op: 'contains', value: 'Dentist' }] }),
  ]
  const hits = rulesMatching(rules, flight())
  assert.deepEqual(hits.map(h => h.rule.id), ['a', 'b'])
  assert.deepEqual(hits[0].captures, ['5274S'])
  assert.deepEqual(hits[1].captures, [])
})

// --- has it started yet? ---------------------------------------------------
//
// The clock is an argument, never read inside the module — the whole point of
// this file is that these answers don't depend on when it runs.

const CLOCK = { now: '2026-08-25T15:00:00Z', todayYmd: '2026-08-25' }

test('a timed event that has not started yet is upcoming', () => {
  assert.equal(eventIsUpcoming(flight({ start: { dateTime: '2026-08-26T09:00:00-05:00' } }), CLOCK), true)
})

test('a timed event already under way is not upcoming', () => {
  // The flight runs 09:00–11:00 local and it is 10:00. The Calendar API still
  // returns it, because timeMin filters on the event's END — which is exactly
  // the case this option exists for.
  assert.equal(eventIsUpcoming(flight(), CLOCK), false)
})

test('an all-day event covering today is happening now, not in the future', () => {
  assert.equal(eventIsUpcoming(flight({ start: { date: '2026-08-25' } }), CLOCK), false)
  assert.equal(eventIsUpcoming(flight({ start: { date: '2026-08-26' } }), CLOCK), true)
  assert.equal(eventIsUpcoming(flight({ start: { date: '2026-08-24' } }), CLOCK), false)
})

test('an unreadable start is treated as upcoming rather than silently withheld', () => {
  // Withholding on a value we failed to parse would drop a task with no trace.
  assert.equal(eventIsUpcoming(flight({ start: { dateTime: 'not-a-date' } }), CLOCK), true)
  assert.equal(eventIsUpcoming(flight({ start: {} }), CLOCK), true)
  assert.equal(eventIsUpcoming(flight({ start: { date: '2026-08-25' } }), { now: CLOCK.now, todayYmd: null }), true)
})

test('future_only is off unless asked for — existing rules are unaffected', () => {
  const r = normalizeRule({
    name: 'x',
    conditions: [{ field: 'title', op: 'contains', value: 'a' }],
    template: { title: 'y' },
  })
  assert.equal(r.future_only, false)
  assert.equal(normalizeRule({ ...r, future_only: true }).future_only, true)
})

test('matchEvent still has no clock — an event under way matches exactly as it did', () => {
  // Load-bearing: the suppression query is built on matchEvent, so if this
  // started depending on the time, a suppressed flight would reappear in the
  // task list the moment it took off.
  const r = rule({ future_only: true })
  assert.equal(matchEvent(r, flight()).matched, true)
})

// --- what a repeat firing does ---------------------------------------------

test('a repeat pulls the due date EARLIER but never pushes it out', () => {
  // The failure this prevents: taking the newest event's date walks the task to
  // the far edge of the 30-day window every time a flight appears, so it never
  // comes due and never surfaces — a deferral nobody asked for.
  assert.equal(soonestDueDate('2026-09-18', '2026-09-11'), '2026-09-11')
  assert.equal(soonestDueDate('2026-09-11', '2026-09-18'), '2026-09-11', 'the later event does not push it out')
})

test('an already-overdue task stays overdue — you still owe it', () => {
  assert.equal(soonestDueDate('2026-08-01', '2026-09-11'), '2026-08-01')
})

test('a task with no due date takes the new one, and no new date changes nothing', () => {
  assert.equal(soonestDueDate(null, '2026-09-11'), '2026-09-11')
  assert.equal(soonestDueDate('2026-09-11', null), '2026-09-11')
  assert.equal(soonestDueDate(null, null), null)
})

test('on_repeat defaults to stack and only accepts known modes', () => {
  const base = { name: 'x', conditions: [{ field: 'title', op: 'contains', value: 'a' }], template: { title: 'y' } }
  assert.equal(normalizeRule(base).on_repeat, 'stack')
  assert.equal(normalizeRule({ ...base, on_repeat: 'update' }).on_repeat, 'update')
  assert.equal(normalizeRule({ ...base, on_repeat: 'nonsense' }).on_repeat, 'stack', 'an unknown mode falls back, never throws mid-poll')
})

// --- condition groups: or inside, and across ------------------------------

const twoTails = () => rule({
  conditions: [
    { field: 'title', op: 'contains', value: 'N5274S', group: 0 },
    { field: 'title', op: 'contains', value: 'N12345', group: 0 },
    { field: 'location', op: 'contains', value: "Hap's", group: 1 },
  ],
})

test('either alternative in a group satisfies it', () => {
  assert.equal(matchEvent(twoTails(), flight()).matched, true)
  assert.equal(matchEvent(twoTails(), flight({ summary: 'Ryan Kelch in N12345' })).matched, true)
})

test('but every group still has to match', () => {
  assert.equal(matchEvent(twoTails(), flight({ location: 'Des Moines' })).matched, false)
  assert.equal(matchEvent(twoTails(), flight({ summary: 'Ryan Kelch in N99999' })).matched, false)
})

test('a rule saved BEFORE groups existed keeps meaning all-ANDed', () => {
  // The compatibility that makes this safe to ship without a data migration:
  // no group index means "its own group", so two ungrouped conditions are
  // ANDed exactly as they always were — never silently loosened into an OR.
  const legacy = rule({
    conditions: [
      { field: 'title', op: 'contains', value: 'N5274S' },
      { field: 'location', op: 'contains', value: 'Des Moines' },
    ],
  })
  assert.equal(matchEvent(legacy, flight()).matched, false, 'still ANDed, so the wrong location misses')
  assert.equal(groupConditions(legacy.conditions).length, 2, 'two groups of one, not one group of two')
})

test('captures come only from the alternatives that actually matched', () => {
  const r = rule({
    conditions: [
      { field: 'title', op: 'matches', value: 'N(1\\d{4})', group: 0 },
      { field: 'title', op: 'matches', value: 'N(5\\d{3}[A-Z])', group: 0 },
    ],
  })
  const m = matchEvent(r, flight())
  assert.equal(m.matched, true)
  assert.deepEqual(m.captures, ['5274S'], 'the branch that missed contributes nothing')
  assert.equal(renderTemplate('Log {{match.1}} hours', flight(), m.captures), 'Log 5274S hours')
})

test('normalizing renumbers groups densely, in first-appearance order', () => {
  const r = normalizeRule({
    name: 'x',
    conditions: [
      { field: 'title', op: 'contains', value: 'a', group: 5 },
      { field: 'location', op: 'contains', value: 'b', group: 9 },
      { field: 'title', op: 'contains', value: 'c', group: 5 },
    ],
    template: { title: 'y' },
  })
  assert.deepEqual(r.conditions.map(c => c.group), [0, 1, 0])
})

test('ungrouped conditions are stamped as separate groups on save', () => {
  const r = normalizeRule({
    name: 'x',
    conditions: [
      { field: 'title', op: 'contains', value: 'a' },
      { field: 'location', op: 'contains', value: 'b' },
    ],
    template: { title: 'y' },
  })
  assert.deepEqual(r.conditions.map(c => c.group), [0, 1], 'preserved as ANDed, now explicitly')
})

test('a nonsense group index is rejected rather than silently bucketed', () => {
  assert.throws(() => normalizeRule({
    name: 'x',
    conditions: [{ field: 'title', op: 'contains', value: 'a', group: 'first' }],
    template: { title: 'y' },
  }), /whole number/)
})

test('evaluateCondition is the single per-condition judgement', () => {
  assert.equal(evaluateCondition({ field: 'title', op: 'contains', value: 'N5274S' }, flight()).matched, true)
  assert.equal(evaluateCondition({ field: 'title', op: 'nonsense', value: 'x' }, flight()).matched, false)
})

// --- a real event, verbatim from the Calendar API --------------------------
//
// The Sep 1 booking, copied field-for-field out of a live
// GET /calendars/rkelch@gmail.com/events response (2026-08-26) rather than
// retyped. It exists because a rule reading `Title contains N5274S` reported
// "scanned 5 events - 0 matches" while nine events like this one sat in the
// window: the matcher was never the problem, the calendar being read was. This
// fixture is what makes that claim checkable instead of asserted.
//
// Note the description: FlightCircle writes a raw HTML anchor, not text. Worth
// knowing before anyone writes a rule that matches on description.
const realFlight = () => ({
  id: '6642f81778030c02a7cc027a12b8de8b85b068b4',
  summary: 'Ryan Kelch in N5274S with Marty Kemp',
  location: "Hap's Air Service 2508 Airport Dr, Ames, IA, 50010",
  description: "<a href='https://www.flightcircle.com/v1/#/schedule?action=edit&id=52e72b758cca5b30d379f4b630ee63b0d33fb1b5'>Tap here to update your reservation</a>",
  status: 'confirmed',
  start: { dateTime: '2026-09-01T09:00:00-05:00', timeZone: 'America/Chicago' },
  end: { dateTime: '2026-09-01T11:00:00-05:00', timeZone: 'America/Chicago' },
  organizer: { email: 'rkelch@gmail.com', displayName: '' },
  attendees: [],
  recurringEventId: null,
  calendarId: 'rkelch@gmail.com',
})

test("the reported rule — Title contains N5274S — matches the real event", () => {
  const r = normalizeRule({
    name: 'Update Flight Budget',
    conditions: [{ field: 'title', op: 'contains', value: 'N5274S' }],
    template: { title: 'Update flight budget sheet with actuals', due_offset_days: 1 },
  })
  assert.equal(matchEvent({ ...r, enabled: true }, realFlight()).matched, true)
})

test('and produces the task that was configured, due the day after the flight', () => {
  const r = normalizeRule({
    name: 'Update Flight Budget',
    conditions: [{ field: 'title', op: 'contains', value: 'N5274S' }],
    template: {
      title: 'Update flight budget sheet with actuals',
      notes: 'http://drive.google.com/something',
      due_offset_days: 1,
      size: 'S',
      high_priority: true,
    },
  })
  const { captures } = matchEvent({ ...r, enabled: true }, realFlight())
  const task = buildTaskFromRule(r, realFlight(), { id: 't1', now: '2026-08-26T12:00:00Z', captures })
  assert.equal(task.title, 'Update flight budget sheet with actuals')
  assert.equal(task.due_date, '2026-09-02', 'the flight is Sep 1; +1 day')
  assert.equal(task.size, 'S')
  assert.equal(task.high_priority, true)
  assert.equal(task.gcal_event_id, undefined, 'still never owns the calendar event')
})

test('it is upcoming, so a future_only rule fires on it', () => {
  assert.equal(eventIsUpcoming(realFlight(), { now: '2026-08-26T12:00:00Z', todayYmd: '2026-08-26' }), true)
})

test('the tail number can be captured out of the real title', () => {
  const r = rule({ conditions: [{ field: 'title', op: 'matches', value: 'N(\\d{4}[A-Z])' }] })
  const m = matchEvent(r, realFlight())
  assert.deepEqual(m.captures, ['5274S'])
  assert.equal(renderTemplate('Log {{match.1}} — {{event.date}}', realFlight(), m.captures), 'Log 5274S — 2026-09-01')
})

test('an OR group over two tail numbers matches it, and location narrows it', () => {
  const r = normalizeRule({
    name: 'Either aircraft, at Haps',
    conditions: [
      { field: 'title', op: 'contains', value: 'N5274S', group: 0 },
      { field: 'title', op: 'contains', value: 'N12345', group: 0 },
      { field: 'location', op: 'contains', value: "Hap's Air Service", group: 1 },
    ],
    template: { title: 'Update budget', due_offset_days: 1 },
  })
  assert.equal(matchEvent({ ...r, enabled: true }, realFlight()).matched, true)
  assert.equal(
    matchEvent({ ...r, enabled: true }, { ...realFlight(), location: 'Des Moines Flying Service' }).matched,
    false,
    'the location group still has to match',
  )
})

test("a rule pinned to a DIFFERENT calendar does not match it — the reported failure, reproduced", () => {
  // What the user was actually hitting: right conditions, wrong calendar.
  const r = rule({
    calendar_id: 'ryan@kelch.dev',
    conditions: [{ field: 'title', op: 'contains', value: 'N5274S' }],
  })
  assert.equal(matchEvent(r, realFlight()).matched, false)
  assert.equal(matchEvent({ ...r, calendar_id: 'rkelch@gmail.com' }, realFlight()).matched, true)
})
