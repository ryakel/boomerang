import test from 'node:test'
import assert from 'node:assert/strict'
import { cycleWindows, loopGaps, cycleRally, isWindowPaused } from '../src/kept/cycles.js'

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


// --- Away windows -----------------------------------------------------
//
// "A bunch of loops broke because of my vacation and I seem to have no way to
// fix them" (2026-08-11). The away window protected notifications, then the
// streak, then the device alarms — loops were the fourth consumer and were
// never wired up. A daily loop over a 6-day trip minted 6 missed cycles and
// reset the rally, and reconcile_loops could not clear them: it only stamps
// days a FINISHED task proves, and a holiday has none.

const ymd = (d) => {
  const p = (v) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const daysAgo = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d }
const spanAgo = (from, to) => {
  const out = []
  for (let n = from; n >= to; n--) out.push(ymd(daysAgo(n)))
  return out
}

// A daily loop running for a month, never completed, with a trip 8..3 days ago.
const dailyLoop = () => ({
  id: 'vac', cadence: 'daily',
  created_at: daysAgo(30).toISOString(),
  completed_history: [],
})

test('THE REGRESSION: a daily loop reports no missed cycles for days spent away', () => {
  const away = new Set(spanAgo(8, 3))
  const withAway = loopGaps(dailyLoop(), [], 12, away).missed.map(g => g.day)
  for (const day of away) {
    assert.ok(!withAway.includes(day), `${day} was an away day and must not read as missed`)
  }
})

test('the same loop WITHOUT the away days reports every one of them — this is the bug', () => {
  const bare = loopGaps(dailyLoop(), [], 12, null).missed.map(g => g.day)
  for (const day of spanAgo(8, 3)) {
    assert.ok(bare.includes(day), `${day} should be missed when nothing knows about the trip`)
  }
})

test('days at home around the trip are still genuinely missed', () => {
  // Away must excuse the trip and nothing else, or it quietly forgives real
  // misses and the "N to fix" count stops meaning anything.
  const away = new Set(spanAgo(8, 3))
  const missed = loopGaps(dailyLoop(), [], 12, away).missed.map(g => g.day)
  assert.ok(missed.includes(ymd(daysAgo(9))), 'the day before the trip is a real miss')
  assert.ok(missed.includes(ymd(daysAgo(2))), 'the day after the trip is a real miss')
})

// The rule is: the cycle's DUE DAY (its window start) was an away day.
// "It should match the days away, full stop" — with two named constraints:
// "no misses because it didn't overlap and no month long gaps."
const win = (startDaysAgo, spanDays) => {
  const start = daysAgo(startDaysAgo)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + spanDays)
  return { key: ymd(start), start, end, hits: 0, current: false }
}

test('CONSTRAINT 1: a weekly cycle DUE mid-trip is excused even though its window runs past the trip', () => {
  // The old every-elapsed-day-away rule called this MISSED because the tail of
  // the window (days at home after getting back) wasn't away — a miss
  // manufactured by the window not lining up with the holiday.
  assert.equal(isWindowPaused(win(6, 7), new Set(spanAgo(8, 3))), true)
})

test('CONSTRAINT 2: one day away does NOT excuse a whole month', () => {
  // The any-day-of-the-window rule would forgive the entire month. A monthly
  // cycle due on a day you were home stays your responsibility.
  const monthly = win(20, 30) // due 20 days ago, well before the trip
  assert.equal(isWindowPaused(monthly, new Set(spanAgo(8, 3))), false)
})

test('a monthly cycle due DURING the trip is excused', () => {
  assert.equal(isWindowPaused(win(5, 30), new Set(spanAgo(8, 3))), true)
})

test('a cycle due on a day at home is not excused by a trip later in its window', () => {
  // Due the day before leaving: you were home when it came up.
  assert.equal(isWindowPaused(win(9, 7), new Set(spanAgo(8, 3))), false)
})

test('an in-flight cycle that came due during the trip is excused', () => {
  const w = { ...win(1, 7), current: true }
  assert.equal(isWindowPaused(w, new Set([ymd(daysAgo(1)), ymd(daysAgo(0))])), true)
})

test('no away days means nothing changes', () => {
  const bare = loopGaps(dailyLoop(), [], 12, null).missed.length
  assert.equal(loopGaps(dailyLoop(), [], 12, new Set()).missed.length, bare)
  assert.equal(loopGaps(dailyLoop(), [], 12, []).missed.length, bare)
})

test('the rally steps over an away cycle instead of breaking on it', () => {
  // Caught 12..9 days ago, away 8..3, caught 2..0. The trip must neither
  // break the run nor pad it: 4 + 3 = 7, not 0 and not 13.
  const caught = [...spanAgo(12, 9), ...spanAgo(2, 0)]
  const routine = {
    id: 'r', cadence: 'daily',
    created_at: daysAgo(12).toISOString(),
    completed_history: caught.map(d => `${d}T12:00:00.000Z`),
  }
  const wins = cycleWindows(routine, 60)
  const away = new Set(spanAgo(8, 3))
  assert.equal(cycleRally(wins, 1, away).rally, 7)
  // Without the away days the same history reads as a 3-cycle rally: the
  // trip broke it. That is exactly what the user saw.
  assert.equal(cycleRally(wins, 1).rally, 3)
})

test('an away cycle does not inflate best, either', () => {
  const routine = {
    id: 'r', cadence: 'daily',
    created_at: daysAgo(12).toISOString(),
    completed_history: spanAgo(12, 9).map(d => `${d}T12:00:00.000Z`),
  }
  const wins = cycleWindows(routine, 60)
  // 4 caught cycles, then away, then nothing done since coming home. Best is
  // the 4 real ones — the trip adds nothing.
  assert.equal(cycleRally(wins, 1, new Set(spanAgo(8, 3))).best, 4)
})
