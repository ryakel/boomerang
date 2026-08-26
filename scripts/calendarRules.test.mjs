import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  matchEvent, renderTemplate, buildTaskFromRule, normalizeRule,
  eventDate, eventTime, shiftDate, rulesMatching, eventIsUpcoming,
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
