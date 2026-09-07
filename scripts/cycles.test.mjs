import test from 'node:test'
import assert from 'node:assert/strict'
import { cycleWindows, loopGaps, cycleRally, isWindowPaused, bridgedAwayKeys, stampLoopDay, unstampLoopDay } from '../src/kept/cycles.js'
import { localYMD as localDay } from '../src/dates.js'

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


// --- The away bucket + the trail bridge (2026-08-23) ------------------
//
// Away cycles used to be dropped from loopGaps entirely: protected, but
// invisible, so a trip left no trace and no way to say "start again next
// week". They now come back in their own `away` bucket, which drives the
// "While you were away" prompt. They stay OUT of `missed`, so the rally
// protection and the "N to fix" badge are unchanged.

test('away cycles come back in their own bucket, not as missed', () => {
  const away = new Set(spanAgo(8, 3))
  const gaps = loopGaps(dailyLoop(), [], 12, away)
  assert.equal(gaps.missed.filter(g => away.has(g.day)).length, 0, 'never blamed as missed')
  assert.deepEqual(gaps.away.map(g => g.day).sort(), [...away].sort(), 'all surfaced for rescheduling')
})

test('the away bucket is empty when nothing was away', () => {
  assert.deepEqual(loopGaps(dailyLoop(), [], 12, null).away, [])
})

test('habit loops and stacks report an away bucket rather than undefined', () => {
  // The UI does `gaps.away.length` — a missing key would throw on those paths.
  assert.deepEqual(loopGaps({ id: 'h', spawn_mode: 'habit' }, [], 12, new Set(spanAgo(8, 3))).away, [])
})

test('the trail bridges an away run that the loop came back from', () => {
  // Caught 12..9 days ago, away 8..3, caught 2..0 — the break is bridged.
  const routine = {
    id: 'r', cadence: 'daily', created_at: daysAgo(12).toISOString(),
    completed_history: [...spanAgo(12, 9), ...spanAgo(2, 0)].map(d => `${d}T12:00:00.000Z`),
  }
  const wins = cycleWindows(routine, 60)
  const bridged = bridgedAwayKeys(wins, new Set(spanAgo(8, 3)))
  assert.deepEqual([...bridged].sort(), spanAgo(8, 3).sort())
})

test('a trip the loop never came back from is NOT bridged', () => {
  // Nothing completed since the trip: that is a loop that stopped, and a
  // connector over it would be the chart telling a nicer story than the truth.
  const routine = {
    id: 'r', cadence: 'daily', created_at: daysAgo(12).toISOString(),
    completed_history: spanAgo(12, 9).map(d => `${d}T12:00:00.000Z`),
  }
  const bridged = bridgedAwayKeys(cycleWindows(routine, 60), new Set(spanAgo(8, 3)))
  assert.equal(bridged.size, 0)
})

test('a caught cycle is never bridged, and no away days means no bridging', () => {
  const routine = {
    id: 'r', cadence: 'daily', created_at: daysAgo(12).toISOString(),
    completed_history: spanAgo(12, 0).map(d => `${d}T12:00:00.000Z`),
  }
  const wins = cycleWindows(routine, 60)
  assert.equal(bridgedAwayKeys(wins, new Set(spanAgo(8, 3))).size, 0, 'days that were worked stay solid')
  assert.equal(bridgedAwayKeys(wins, null).size, 0)
})

// --- Retroactive day logging (stampLoopDay / unstampLoopDay) ------------
//
// "We did the bedtime routine on Friday, it's Monday and I can't get back to
// fix it." The gap list could not offer that day — the loop is a stack, and
// stacks never report a missed cycle and only report an unrecorded one when
// every member task of the cycle is done. These are the rules for the manual
// route that replaces it.

const ymdAgo = (n) => ymd(daysAgo(n))

test('stamping a past day credits it, and stamping again is a no-op on the same object', () => {
  const day = ymdAgo(3)
  const routine = { id: 'r', cadence: 'daily', created_at: daysAgo(30).toISOString(), completed_history: [] }
  const once = stampLoopDay(routine, day)
  assert.equal(once.completed_history.length, 1)
  assert.equal(localDay(once.completed_history[0]), day)
  // Same reference on a repeat: callers map over React state with this, and a
  // fresh object for a no-op re-renders every consumer of the loop.
  assert.equal(stampLoopDay(once, day), once)
  assert.equal(stampLoopDay(once, day).completed_history.length, 1)
})

test('a stack cycle the gap list cannot see is still fixable by hand', () => {
  // Half the members ticked: loopGaps reports nothing (not all done ⇒ not
  // "unrecorded", and stacks never report "missed"), so the manual stamp is
  // the ONLY way to record the cycle.
  const day = ymdAgo(3)
  const routine = {
    id: 'bedtime', cadence: 'daily', created_at: daysAgo(30).toISOString(),
    members: [{ id: 'm1', title: 'teeth' }, { id: 'm2', title: 'story' }],
    completed_history: [],
  }
  const tasks = [
    { id: 't1', routine_id: 'bedtime', due_date: day, status: 'done', completed_at: `${day}T20:00:00.000Z` },
    { id: 't2', routine_id: 'bedtime', due_date: day, status: 'todo' },
  ]
  const gaps = loopGaps(routine, tasks)
  assert.deepEqual(gaps.unrecorded, [])
  assert.deepEqual(gaps.missed, [])

  const fixed = stampLoopDay(routine, day)
  const win = cycleWindows(fixed, 30).find(w => w.key === day)
  assert.equal(win.caught, true, 'the cycle now reads as caught')
})

test('marking a day done clears an earlier skip of that day', () => {
  // A day cannot be both skipped and credited. Left behind, the skip would keep
  // the day out of the gap list for the wrong reason — so un-logging a mistaken
  // stamp would not bring the day back to be answered for.
  const day = ymdAgo(4)
  const routine = {
    id: 'r', cadence: 'daily', created_at: daysAgo(30).toISOString(),
    completed_history: [], skipped_days: [day, ymdAgo(5)],
  }
  const fixed = stampLoopDay(routine, day)
  assert.deepEqual(fixed.skipped_days, [ymdAgo(5)])
  // Idempotent on the skip too: a routine already credited but still carrying
  // the stale skip gets it cleaned up rather than left half-fixed.
  const stale = { ...routine, completed_history: [`${day}T12:00:00.000Z`] }
  assert.deepEqual(stampLoopDay(stale, day).skipped_days, [ymdAgo(5)])
})

test('a real completion time is kept only when it lands on the same local day', () => {
  const day = ymdAgo(2)
  const routine = { id: 'r', cadence: 'daily', created_at: daysAgo(30).toISOString(), completed_history: [] }
  const sameDay = `${day}T18:30:00.000Z`
  assert.equal(stampLoopDay(routine, day, sameDay).completed_history[0], sameDay)
  // A stamp that buckets to a DIFFERENT local day would never satisfy the
  // idempotency check, so the gap would re-stamp on every click forever.
  const drifted = `${ymdAgo(1)}T18:30:00.000Z`
  assert.equal(stampLoopDay(routine, day, drifted).completed_history[0], `${day}T12:00:00.000Z`)
})

test('stamping self-heals exact-duplicate history entries', () => {
  const dup = `${ymdAgo(6)}T12:00:00.000Z`
  const routine = {
    id: 'r', cadence: 'daily', created_at: daysAgo(30).toISOString(),
    completed_history: [dup, dup, dup],
  }
  assert.deepEqual(stampLoopDay(routine, ymdAgo(6)).completed_history, [dup])
  assert.equal(stampLoopDay(routine, ymdAgo(1)).completed_history.length, 2)
})

test('un-stamping removes the most recent entry for that day only', () => {
  const day = ymdAgo(2)
  const other = ymdAgo(1)
  const routine = {
    id: 'r', cadence: 'daily', created_at: daysAgo(30).toISOString(),
    completed_history: [`${day}T08:00:00.000Z`, `${day}T20:00:00.000Z`, `${other}T09:00:00.000Z`],
  }
  const once = unstampLoopDay(routine, day)
  assert.deepEqual(once.completed_history, [`${day}T08:00:00.000Z`, `${other}T09:00:00.000Z`])
  const twice = unstampLoopDay(once, day)
  assert.deepEqual(twice.completed_history, [`${other}T09:00:00.000Z`])
  // Nothing to remove: same object back, and the day is NOT re-skipped —
  // "that didn't happen" is a question the loop should be free to ask again.
  assert.equal(unstampLoopDay(twice, day), twice)
  assert.equal(twice.skipped_days, undefined)
})

test('stamp/unstamp round-trips leave the history exactly as it was', () => {
  const day = ymdAgo(3)
  const history = [`${ymdAgo(9)}T12:00:00.000Z`, `${ymdAgo(1)}T12:00:00.000Z`]
  const routine = { id: 'r', cadence: 'daily', created_at: daysAgo(30).toISOString(), completed_history: history }
  assert.deepEqual(unstampLoopDay(stampLoopDay(routine, day), day).completed_history, history)
})
