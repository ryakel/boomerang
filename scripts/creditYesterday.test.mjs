import test from 'node:test'
import assert from 'node:assert/strict'
import { canCreditYesterday, creditYesterday, creditedCompletionIso } from '../src/creditYesterday.js'
import { localYMD } from '../src/dates.js'

// All clocks are LOCAL, built with the Date(y, m, d, h) constructor, so the
// tests mean the same thing in any TZ the suite runs in.
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m) // October 2026
const iso = (d, h, m = 0) => at(d, h, m).toISOString()
const NOW = at(31, 7, 30) // Saturday morning
const TODAY = '2026-10-31'
const YESTERDAY = '2026-10-30'

const doneThisMorning = (over = {}) => ({
  id: 't1', title: 'Dishes', status: 'done',
  created_at: iso(30, 18), completed_at: iso(31, 7, 25), ...over,
})

test('eligible: ticked this morning, existed before today', () => {
  assert.equal(canCreditYesterday(doneThisMorning(), NOW), true)
})

test('not eligible: created today — cannot have been done last night', () => {
  assert.equal(canCreditYesterday(doneThisMorning({ created_at: iso(31, 6) }), NOW), false)
})

test('not eligible: ticked after the noon cutoff', () => {
  const t = doneThisMorning({ completed_at: iso(31, 12, 5) })
  assert.equal(canCreditYesterday(t, at(31, 12, 6)), false)
})

test('the cutoff gates the tick, not the answer: a 9am tick can be fixed at 2pm', () => {
  assert.equal(canCreditYesterday(doneThisMorning({ completed_at: iso(31, 9) }), at(31, 14)), true)
})

test('not eligible: not done, or completed on an earlier day', () => {
  assert.equal(canCreditYesterday(doneThisMorning({ status: 'not_started' }), NOW), false)
  assert.equal(canCreditYesterday(doneThisMorning({ completed_at: iso(30, 21) }), NOW), false)
  assert.equal(canCreditYesterday(doneThisMorning({ completed_at: null }), NOW), false)
  assert.equal(canCreditYesterday(null, NOW), false)
})

test('credited completion lands yesterday evening', () => {
  const { taskUpdates } = creditYesterday({ task: doneThisMorning(), now: NOW })
  assert.equal(localYMD(new Date(taskUpdates.completed_at)), YESTERDAY)
  assert.equal(new Date(taskUpdates.completed_at).getHours(), 20)
})

test('credited completion never precedes creation', () => {
  const late = doneThisMorning({ created_at: iso(30, 22, 15) })
  const got = new Date(creditedCompletionIso(late, NOW))
  assert.equal(localYMD(got), YESTERDAY)
  assert.ok(got.getTime() > new Date(late.created_at).getTime())
  const lastSecond = doneThisMorning({ created_at: new Date(2026, 9, 30, 23, 59, 59, 500).toISOString() })
  const got2 = new Date(creditedCompletionIso(lastSecond, NOW))
  assert.equal(localYMD(got2), YESTERDAY, 'clamped inside yesterday')
  assert.ok(got2.getTime() >= new Date(lastSecond.created_at).getTime())
})

test('idempotent: applying the credit makes the task ineligible', () => {
  const task = doneThisMorning()
  const { taskUpdates } = creditYesterday({ task, now: NOW })
  const again = creditYesterday({ task: { ...task, ...taskUpdates }, now: NOW })
  assert.equal(again.taskUpdates, null)
})

test('reverses last night\'s rollover bump', () => {
  const task = doneThisMorning({ boomerang_count: 2, last_boomeranged_at: iso(31, 0, 30), committed_on: null })
  const { taskUpdates } = creditYesterday({ task, now: NOW })
  assert.equal(taskUpdates.boomerang_count, 1)
  assert.equal(taskUpdates.last_boomeranged_at, null)
  assert.equal(taskUpdates.committed_on, YESTERDAY)
})

test('leaves an older rollover alone', () => {
  const task = doneThisMorning({ boomerang_count: 1, last_boomeranged_at: iso(29, 0, 30) })
  const { taskUpdates } = creditYesterday({ task, now: NOW })
  assert.equal('boomerang_count' in taskUpdates, false)
  assert.equal('last_boomeranged_at' in taskUpdates, false)
})

test('never takes the count below zero', () => {
  const task = doneThisMorning({ boomerang_count: 0, last_boomeranged_at: iso(31, 0, 30) })
  assert.equal(creditYesterday({ task, now: NOW }).taskUpdates.boomerang_count, 0)
})

const loop = (history, over = {}) => ({ id: 'r1', cadence: 'daily', completed_history: history, ...over })

test('loop: today\'s stamp moves to yesterday', () => {
  const routine = loop([iso(29, 20), iso(31, 7, 25)])
  const task = doneThisMorning({ routine_id: 'r1' })
  const out = creditYesterday({ task, routine, now: NOW }).routine
  const days = out.completed_history.map(ts => localYMD(new Date(ts)))
  assert.deepEqual(days, ['2026-10-29', YESTERDAY])
})

test('loop: yesterday already stamped — today\'s comes off, no duplicate', () => {
  const routine = loop([iso(30, 19), iso(31, 7, 25)])
  const out = creditYesterday({ task: doneThisMorning({ routine_id: 'r1' }), routine, now: NOW }).routine
  assert.deepEqual(out.completed_history.map(ts => localYMD(new Date(ts))), [YESTERDAY])
})

test('loop: crediting yesterday clears a skip recorded for it', () => {
  const routine = loop([iso(31, 7, 25)], { skipped_days: [YESTERDAY] })
  const out = creditYesterday({ task: doneThisMorning({ routine_id: 'r1' }), routine, now: NOW }).routine
  assert.deepEqual(out.skipped_days, [])
})

test('loop: no stamp today — nothing invented, same reference back', () => {
  const routine = loop([iso(29, 20)])
  const out = creditYesterday({ task: doneThisMorning({ routine_id: 'r1' }), routine, now: NOW }).routine
  assert.equal(out, routine)
})

test('loop: a routine that is not this task\'s is never touched', () => {
  const routine = loop([iso(31, 7, 25)], { id: 'other' })
  const out = creditYesterday({ task: doneThisMorning({ routine_id: 'r1' }), routine, now: NOW }).routine
  assert.equal(out, routine)
})

test('ineligible task: routine comes back untouched', () => {
  const routine = loop([iso(31, 7, 25)])
  const task = doneThisMorning({ routine_id: 'r1', created_at: iso(31, 6) })
  const out = creditYesterday({ task, routine, now: NOW })
  assert.equal(out.taskUpdates, null)
  assert.equal(out.routine, routine)
})

const stack = (history) => loop(history, { members: [{ title: 'Dishes' }, { title: 'Trash' }] })
const member = (id, over = {}) => doneThisMorning({ id, routine_id: 'r1', due_date: YESTERDAY, ...over })

test('stack: stamp stays on today while another member was really done today', () => {
  const routine = stack([iso(31, 7, 25)])
  const siblings = [member('t1'), member('t2', { completed_at: iso(31, 7, 20) })]
  const out = creditYesterday({ task: siblings[0], routine, siblings, now: NOW }).routine
  assert.equal(out, routine)
})

test('stack: stamp moves once every member is credited to yesterday', () => {
  const routine = stack([iso(31, 7, 25)])
  const siblings = [member('t1'), member('t2', { completed_at: iso(30, 20) })]
  const out = creditYesterday({ task: siblings[0], routine, siblings, now: NOW }).routine
  assert.deepEqual(out.completed_history.map(ts => localYMD(new Date(ts))), [YESTERDAY])
})

test('stack: an open member keeps the stamp where it is', () => {
  const routine = stack([iso(31, 7, 25)])
  const siblings = [member('t1'), member('t2', { status: 'not_started', completed_at: null })]
  assert.equal(creditYesterday({ task: siblings[0], routine, siblings, now: NOW }).routine, routine)
})

test('the day keys used are local', () => {
  assert.equal(localYMD(NOW), TODAY)
})
