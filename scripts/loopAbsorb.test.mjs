import test from 'node:test'
import assert from 'node:assert/strict'
import { planLoopAbsorption, clockOf } from '../src/loopAbsorb.js'

// The rule these pin: converting a task that carries a one-off reminder into a
// LOOP must not produce two bells for one intention, and must not silently
// delete a reminder the user still expects. Absorb when the loop's first cycle
// already covers that moment; otherwise leave it alone. Every case reports a
// nudge so the user is told which happened BEFORE they commit.

const at = (s) => new Date(s).getTime()

test('no reminder → nothing to decide, no nudge', () => {
  const p = planLoopAbsorption({ remindAt: null, firstSpawn: '2026-08-03', cadence: 'daily' })
  assert.equal(p.absorb, false)
  assert.equal(p.clearTaskRemind, false)
  assert.equal(p.nudge, '')
})

test('unparseable reminder is treated as no reminder, never as "now"', () => {
  const p = planLoopAbsorption({ remindAt: 'not a date', firstSpawn: '2026-08-03', cadence: 'daily' })
  assert.equal(p.absorb, false)
  assert.equal(p.nudge, '')
})

test('reminder inside the first cycle is ABSORBED and its clock becomes trigger_time', () => {
  const p = planLoopAbsorption({
    remindAt: '2026-08-03T19:30:00',
    firstSpawn: new Date(2026, 7, 3),        // Aug 3
    cadence: 'daily',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(p.absorb, true)
  assert.equal(p.triggerTime, '19:30')
  // The pending ring is KEPT: the converted task blocks the loop's first
  // spawn, so nothing else would carry it. Clearing would lose the one bell
  // the user is standing in front of.
  assert.equal(p.clearTaskRemind, false)
  assert.match(p.nudge, /every cycle/)
})

test('a weekly loop absorbs a reminder anywhere in its seven-day first cycle', () => {
  const base = { firstSpawn: new Date(2026, 7, 3), cadence: 'weekly', now: at('2026-08-02T12:00:00') }
  // Day 1 of the window and day 7 both land inside; day 8 does not.
  assert.equal(planLoopAbsorption({ ...base, remindAt: '2026-08-03T08:00:00' }).absorb, true)
  assert.equal(planLoopAbsorption({ ...base, remindAt: '2026-08-09T23:59:00' }).absorb, true)
  assert.equal(planLoopAbsorption({ ...base, remindAt: '2026-08-10T00:01:00' }).absorb, false)
})

test('reminder BEFORE the loop starts is kept — the loop is not ringing yet', () => {
  // The case that makes this rule earn its keep: "remind me Tuesday, and every
  // week after that" where the loop's grid puts the first spawn on Thursday.
  const p = planLoopAbsorption({
    remindAt: '2026-08-04T19:30:00',        // Tue
    firstSpawn: new Date(2026, 7, 6),       // Thu
    cadence: 'weekly',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(p.absorb, false)
  assert.equal(p.clearTaskRemind, false)
  assert.match(p.nudge, /before the loop's first cycle/)
})

test('reminder past the first cycle is kept alongside the loop', () => {
  const p = planLoopAbsorption({
    remindAt: '2026-09-20T19:30:00',
    firstSpawn: new Date(2026, 7, 3),
    cadence: 'weekly',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(p.absorb, false)
  assert.equal(p.clearTaskRemind, false)
  assert.match(p.nudge, /past the loop's first cycle/)
})

test('a reminder already in the past is absorbed — its time of day survives, the dead one-off does not', () => {
  const p = planLoopAbsorption({
    remindAt: '2026-08-01T07:15:00',
    firstSpawn: new Date(2026, 7, 3),
    cadence: 'daily',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(p.absorb, true)
  assert.equal(p.triggerTime, '07:15')
  assert.equal(p.clearTaskRemind, true)
  assert.match(p.nudge, /already passed/)
})

test('month-scale cycles step by calendar months, not 30 days', () => {
  // Feb is the case a naive 30-day step gets wrong in both directions.
  const p = planLoopAbsorption({
    remindAt: '2026-03-01T09:00:00',
    firstSpawn: new Date(2026, 1, 1),       // Feb 1
    cadence: 'monthly',
    now: at('2026-01-15T12:00:00'),
  })
  // Mar 1 is exactly the window END for a Feb 1 monthly cycle → NOT inside.
  assert.equal(p.absorb, false)
  const inside = planLoopAbsorption({
    remindAt: '2026-02-28T09:00:00',
    firstSpawn: new Date(2026, 1, 1),
    cadence: 'monthly',
    now: at('2026-01-15T12:00:00'),
  })
  assert.equal(inside.absorb, true)
})

test('custom cadence honours its unit', () => {
  const days = planLoopAbsorption({
    remindAt: '2026-08-05T09:00:00',
    firstSpawn: new Date(2026, 7, 3),
    cadence: 'custom', customDays: 3, customUnit: 'days',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(days.absorb, true)   // Aug 3 + 3d = Aug 6 window end
  const outside = planLoopAbsorption({
    remindAt: '2026-08-07T09:00:00',
    firstSpawn: new Date(2026, 7, 3),
    cadence: 'custom', customDays: 3, customUnit: 'days',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(outside.absorb, false)
  const months = planLoopAbsorption({
    remindAt: '2026-09-20T09:00:00',
    firstSpawn: new Date(2026, 7, 3),
    cadence: 'custom', customDays: 2, customUnit: 'months',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(months.absorb, true) // Aug 3 + 2mo = Oct 3
})

test('a reminder EARLIER in the first spawn day still counts as inside the cycle', () => {
  // getNextDueDate hands back a day (midnight). A 7:30am reminder on that day
  // must not fall "before" the window just because the Date says 00:00.
  const p = planLoopAbsorption({
    remindAt: '2026-08-03T07:30:00',
    firstSpawn: new Date(2026, 7, 3, 9, 0, 0),  // grid answer carrying a time
    cadence: 'daily',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(p.absorb, true)
  assert.equal(p.triggerTime, '07:30')
})

test('missing first spawn keeps the reminder rather than guessing', () => {
  const p = planLoopAbsorption({
    remindAt: '2026-08-03T19:30:00',
    firstSpawn: null,
    cadence: 'weekly',
    now: at('2026-08-02T12:00:00'),
  })
  assert.equal(p.absorb, false)
  assert.equal(p.clearTaskRemind, false)
  assert.notEqual(p.nudge, '')   // still says something — silence is the bug
})

test('clockOf formats local HH:MM with zero padding', () => {
  assert.equal(clockOf(new Date(2026, 7, 3, 7, 5)), '07:05')
  assert.equal(clockOf(new Date(2026, 7, 3, 19, 30)), '19:30')
  assert.equal(clockOf('nonsense'), null)
})
