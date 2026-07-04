import test from 'node:test'
import assert from 'node:assert/strict'
import { cycleWindows, loopGaps } from '../src/kept/cycles.js'

// Regression for: Quokka creates a weekly routine today with
// schedule_day_of_week set to a weekday that already passed this calendar
// week (e.g. created Saturday, scheduled every Thursday). cycleWindows()
// forward-shifts the anchor to next Thursday (correctly mirroring
// getNextDueDate's fixed grid), but its old `Math.max(0, idx)` clamp still
// minted a window at that future anchor, which loopGaps() then had no way
// to distinguish from a genuinely missed past cycle — a brand-new loop
// immediately showed "1 to fix" / "missed last week".

test('brand-new weekly routine with a not-yet-arrived schedule_day_of_week has zero windows and zero gaps', () => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dow = (today.getDay() + 3) % 7 // guaranteed different from today's weekday
  const routine = {
    id: 'r1', cadence: 'weekly', schedule_day_of_week: dow,
    created_at: today.toISOString(), completed_history: [],
  }
  assert.equal(cycleWindows(routine).length, 0)
  const gaps = loopGaps(routine, [])
  assert.deepEqual(gaps.missed, [])
  assert.deepEqual(gaps.unrecorded, [])
})

test('routine created exactly on its scheduled weekday has one current window, not missed', () => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const routine = {
    id: 'r2', cadence: 'weekly', schedule_day_of_week: today.getDay(),
    created_at: today.toISOString(), completed_history: [],
  }
  const windows = cycleWindows(routine)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].current, true)
  assert.deepEqual(loopGaps(routine, []).missed, [])
})

test('an established weekly routine still reports a genuinely missed past cycle', () => {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const created = new Date(today); created.setDate(created.getDate() - 30)
  const routine = {
    id: 'r3', cadence: 'weekly', schedule_day_of_week: today.getDay(),
    created_at: created.toISOString(), completed_history: [],
  }
  const gaps = loopGaps(routine, [])
  // 30 days of weekly cadence with zero completions and no matching tasks:
  // every past window is a genuine miss — the fix must not suppress those.
  assert.ok(gaps.missed.length > 0)
})
