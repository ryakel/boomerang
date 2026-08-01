import { test } from 'node:test'
import assert from 'node:assert/strict'

// triggerRemindAt mirrored from src/hooks/useRoutines.js. The hook can't be
// imported here (React), so the RULES are pinned instead — these are what make
// a nightly loop ring at the same time every night without Boomerang sending
// anything, and they are easy to break silently.
function triggerRemindAt(dueDateYMD, triggerTime, remind) {
  if (!remind || !triggerTime) return null
  const [hh, mm] = String(triggerTime).split(':').map(Number)
  const dt = new Date(`${dueDateYMD}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return null
  dt.setHours(hh || 0, mm || 0, 0, 0)
  return dt.toISOString()
}

test('a loop that opted in gets an alarm at its trigger time', () => {
  const iso = triggerRemindAt('2026-08-09', '19:30', true)
  const d = new Date(iso)
  assert.equal(d.getHours(), 19)
  assert.equal(d.getMinutes(), 30)
})

test('a loop that did NOT opt in never rings, even with a trigger time', () => {
  // trigger_time predates this feature; existing timed loops must stay silent.
  assert.equal(triggerRemindAt('2026-08-09', '19:30', false), null)
})

test('opting in without a time cannot invent one', () => {
  assert.equal(triggerRemindAt('2026-08-09', '', true), null)
  assert.equal(triggerRemindAt('2026-08-09', null, true), null)
})

test('a time already past today still produces an alarm', () => {
  // Unlike the surface-at snooze, which drops a past time. A 7:30pm reminder
  // spawned at 7:45pm must still reach Apple, where it reads as overdue
  // rather than silently never existing.
  const iso = triggerRemindAt('2020-01-01', '07:30', true)
  assert.ok(iso)
  assert.ok(new Date(iso).getTime() < Date.now())
})

test('the alarm lands on the SPAWN day, not today', () => {
  // A rolled or future-spawned instance must ring on its own day.
  const iso = triggerRemindAt('2026-12-25', '08:00', true)
  assert.equal(new Date(iso).getFullYear(), 2026)
  assert.equal(new Date(iso).getMonth(), 11)
  assert.equal(new Date(iso).getDate(), 25)
})

test('midnight is a real time, not a falsy one', () => {
  const iso = triggerRemindAt('2026-08-09', '00:00', true)
  assert.ok(iso, '00:00 must not be read as "no time"')
  assert.equal(new Date(iso).getHours(), 0)
})

test('a malformed day yields no alarm rather than an Invalid Date', () => {
  assert.equal(triggerRemindAt('not-a-date', '19:30', true), null)
})
