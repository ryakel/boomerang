import test from 'node:test'
import assert from 'node:assert/strict'
import { planAlarmRule } from '../server/alarmSchedule.js'
import { ringsSummary, oneOffSummary, armWindow, alarmCardStatus, todayAlarms, clock12, MAX_ARMED } from '../src/alarmRuleModel.js'

// The alarm interface's rules (BOOM-51). State is built with the REAL server
// planner so a change to planning shows up here too.
const TZ = 'America/Chicago'
const DEVICE = '11111111-1111-4111-8111-111111111111'
const RULE_ID = '22222222-2222-4222-8222-222222222222'
const at = (iso) => Date.parse(iso) // instants written with their offset
const SAT_NOON = at('2026-11-21T12:00:00-06:00')
const DAY = 86400000

const pickup = (over = {}) => ({
  id: RULE_ID, deviceId: DEVICE, revision: 1, title: 'School pickup', available: true, conflict: false, heldDates: [],
  sourceKind: 'routine', sourceId: 'r-pickup', enabled: true, timeZone: TZ,
  weekly: [1, 2, 4, 5].map(weekday => ({ weekday, time: '14:00' })).concat({ weekday: 3, time: '13:30' }),
  dates: [], leadMinutes: 5, snoozeMinutes: 5, ackLabel: 'Leaving now', ...over,
})
const stateFor = (rule, now) => ({
  rules: [rule], acknowledgments: {},
  plans: [{ ruleId: rule.id, ...planAlarmRule({ ...rule, enabled: rule.enabled && rule.available && !rule.conflict }, { now }) }],
})
// What the phone reports after arming `items`: a target cue per occurrence,
// plus an early cue, each carrying the entry's target (as the Swift snapshot does).
const nativeFor = (items, over = {}) => ({
  available: true, authorization: 'authorized', deviceId: DEVICE, receipts: [],
  cues: items.flatMap(o => [false, true].map(earlyCue => ({ key: o.key, ruleId: o.ruleId, date: o.date, title: o.title, ackLabel: o.ackLabel, target: Date.parse(o.target) / 1000, timeZone: o.timeZone, earlyCue, state: 'scheduled' }))),
  ...over,
})

test('when it rings: days grouped by time, Monday first', () => {
  assert.deepEqual(ringsSummary(pickup()), ['Mon · Tue · Thu · Fri 2:00 PM', 'Wed 1:30 PM'])
  assert.deepEqual(ringsSummary(pickup({ weekly: [1, 2, 3, 4, 5].map(weekday => ({ weekday, time: '07:15' })) })), ['Weekdays 7:15 AM'])
  assert.deepEqual(ringsSummary(pickup({ weekly: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, time: '21:00' })) })), ['Every day 9:00 PM'])
  assert.deepEqual(ringsSummary(pickup({ weekly: [] })), [])
  assert.equal(clock12('00:05'), '12:05 AM')
  assert.equal(clock12('12:00'), '12:00 PM')
})

test('one-off changes: consecutive skips collapse, past ones drop, extras keep their time', () => {
  const rule = pickup({ dates: [{ date: '2026-11-27', time: null }, { date: '2026-11-26', time: null }, { date: '2026-11-10', time: null }, { date: '2026-12-03', time: '15:00' }, { date: '2026-12-30', time: null }, { date: '2027-01-02', time: null }] })
  const out = oneOffSummary(rule, '2026-11-21')
  assert.deepEqual(out.skips, ['Nov 26 – 27', 'Dec 30', 'Jan 2'])
  assert.deepEqual(out.extras, ['Dec 3 at 3:00 PM'])
})

test('one arming covers the next 16 occurrences in time order, never more', () => {
  const rule = pickup()
  const w = armWindow(stateFor(rule, SAT_NOON), DEVICE)
  assert.equal(w.total, 20, 'five days a week over the 28-day plan')
  assert.equal(w.items.length, MAX_ARMED)
  assert.equal(w.truncated, true)
  assert.equal(w.items[0].date, '2026-11-23')
  assert.equal(w.through, '2026-12-14')
  for (let i = 1; i < w.items.length; i++) assert.ok(Date.parse(w.items[i].target) > Date.parse(w.items[i - 1].target))
  assert.equal(armWindow(stateFor(rule, SAT_NOON), 'some-other-phone').items.length, 0, 'another phone\'s rules are never armed here')
})

test('saved but not armed says how far an arming would reach', () => {
  const rule = pickup(), state = stateFor(rule, SAT_NOON)
  const s = alarmCardStatus({ rule, state, native: nativeFor([]), now: SAT_NOON })
  assert.equal(s.status, 'not-armed')
  assert.equal(s.armsThrough, '2026-12-14')
  assert.equal(s.capped, true)
  assert.deepEqual(s.next.map(o => o.date), ['2026-11-23', '2026-11-24', '2026-11-25'])
})

test('armed, and still armed as the days pass (a sliding window is a renewal, not a change)', () => {
  const rule = pickup(), state = stateFor(rule, SAT_NOON)
  const native = nativeFor(armWindow(state, DEVICE).items)
  const s = alarmCardStatus({ rule, state, native, armedRevision: 1, now: SAT_NOON })
  assert.equal(s.status, 'armed')
  assert.equal(s.armedThrough, '2026-12-14')
  assert.equal(s.renewSoon, false)
  // Three days later: two armed dates are past, the plan has slid forward.
  const later = SAT_NOON + 3 * DAY
  const s2 = alarmCardStatus({ rule, state: stateFor(rule, later), native, armedRevision: 1, now: later })
  assert.equal(s2.status, 'armed')
})

test('renewal is offered within five days of the last armed date, never silently done', () => {
  const rule = pickup(), state = stateFor(rule, SAT_NOON)
  const native = nativeFor(armWindow(state, DEVICE).items)
  const nearEnd = at('2026-12-10T09:00:00-06:00')
  const s = alarmCardStatus({ rule, state: stateFor(rule, nearEnd), native, armedRevision: 1, now: nearEnd })
  assert.equal(s.status, 'armed')
  assert.equal(s.renewSoon, true)
})

test('a changed time or a settings-only edit reads as changes waiting', () => {
  const rule = pickup(), native = nativeFor(armWindow(stateFor(rule, SAT_NOON), DEVICE).items)
  const moved = pickup({ revision: 2, weekly: pickup().weekly.map(x => x.weekday === 3 ? { ...x, time: '13:45' } : x) })
  assert.equal(alarmCardStatus({ rule: moved, state: stateFor(moved, SAT_NOON), native, now: SAT_NOON }).status, 'changes')
  // Snooze length is not in the phone's readback; the armed revision catches it.
  const snooze = pickup({ revision: 2, snoozeMinutes: 10 })
  assert.equal(alarmCardStatus({ rule: snooze, state: stateFor(snooze, SAT_NOON), native, armedRevision: 1, now: SAT_NOON }).status, 'changes')
  assert.equal(alarmCardStatus({ rule: snooze, state: stateFor(snooze, SAT_NOON), native, armedRevision: 2, now: SAT_NOON }).status, 'armed')
})

test('held, off and other-phone states win before anything is compared', () => {
  const native = nativeFor([])
  const st = (rule) => alarmCardStatus({ rule, state: stateFor(rule, SAT_NOON), native, now: SAT_NOON }).status
  assert.equal(st(pickup({ conflict: true })), 'held-reminder')
  assert.equal(st(pickup({ available: false })), 'held-inactive')
  assert.equal(st(pickup({ enabled: false })), 'off')
  assert.equal(st(pickup({ deviceId: '33333333-3333-4333-8333-333333333333' })), 'other-phone')
  assert.equal(st(pickup({ weekly: [] })), 'nothing-upcoming')
  assert.equal(alarmCardStatus({ rule: null, now: SAT_NOON }).status, 'none')
})

test("today's alarm: open until acknowledged, then shown as done; other days and early cues never show", () => {
  const mon = at('2026-11-23T09:00:00-06:00')
  const rule = pickup(), state = stateFor(rule, mon)
  const native = nativeFor(armWindow(state, DEVICE).items)
  const open = todayAlarms({ state, native, now: mon })
  assert.equal(open.length, 1)
  assert.equal(open[0].title, 'School pickup')
  assert.equal(open[0].ackLabel, 'Leaving now')
  assert.equal(open[0].target, at('2026-11-23T14:00:00-06:00'))
  assert.equal(open[0].early, at('2026-11-23T13:55:00-06:00'))
  assert.equal(open[0].doneAt, null)
  // Acknowledged: the phone cancels both cues and keeps a receipt.
  const key = open[0].key
  const acked = { ...native, cues: native.cues.map(c => c.key === key ? { ...c, state: 'cancelled' } : c), receipts: [{ key, ruleId: RULE_ID, date: '2026-11-23', label: 'Leaving now', recordedAt: at('2026-11-23T13:52:00-06:00') / 1000, synced: false }] }
  const done = todayAlarms({ state, native: acked, now: mon })
  assert.equal(done.length, 1)
  assert.equal(done[0].doneAt, at('2026-11-23T13:52:00-06:00'))
  // If the cancelled cue ever drops out of the readback, the receipt still
  // reads as done today.
  const gone = { ...acked, cues: acked.cues.filter(c => c.key !== key) }
  const fromReceipt = todayAlarms({ state, native: gone, now: mon })
  assert.equal(fromReceipt.length, 1)
  assert.equal(fromReceipt[0].title, 'School pickup')
  assert.equal(fromReceipt[0].doneAt, at('2026-11-23T13:52:00-06:00'))
  // A cue that was stopped without acknowledging is not "open" any more.
  const stopped = { ...native, cues: native.cues.map(c => c.key === key ? { ...c, state: 'not-listed' } : c) }
  assert.equal(todayAlarms({ state, native: stopped, now: mon }).length, 0)
  // Saturday has no occurrence.
  assert.equal(todayAlarms({ state: stateFor(rule, SAT_NOON), native, now: SAT_NOON }).length, 0)
})

test('a second alarm behind 16 earlier ones has nowhere to go yet, and says so (no date)', () => {
  const daily = pickup({ id: '44444444-4444-4444-8444-444444444444', title: 'Meds', weekly: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, time: '08:00' })) })
  const late = pickup({ dates: [{ date: '2026-12-15', time: '16:00' }], weekly: [] })
  const state = { rules: [daily, late], acknowledgments: {}, plans: [daily, late].map(r => ({ ruleId: r.id, ...planAlarmRule(r, { now: SAT_NOON }) })) }
  const s = alarmCardStatus({ rule: late, state, native: nativeFor([]), now: SAT_NOON })
  assert.equal(s.status, 'not-armed')
  assert.equal(s.armsThrough, null)
  assert.equal(armWindow(state, DEVICE).items.every(o => o.ruleId === daily.id), true)
})
