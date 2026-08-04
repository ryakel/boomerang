import test from 'node:test'
import assert from 'node:assert/strict'
import { walkStreak, dayKey } from '../server/streakWalk.js'

// The rule a 100-day streak was lost to (2026-08-03): a day away must neither
// break the streak nor build it. These run against the ONE implementation both
// the client (computeStreak) and the server (analytics) now call, so the two
// cannot silently disagree the way they did.

const DAY = 86400000
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()

// Build predicates from plain day-key lists.
const walk = ({ today, kept = [], paused = [], floor = null }) => walkStreak({
  todayMs: today,
  isKept: (d) => kept.includes(dayKey(d)),
  isPaused: (d) => paused.includes(dayKey(d)),
  floorMs: floor,
})

const range = (from, to) => {
  const out = []
  for (let t = from; t <= to; t += DAY) out.push(dayKey(new Date(t)))
  return out
}

test('a plain run of kept days counts', () => {
  const today = at(2026, 8, 10)
  assert.equal(walk({ today, kept: range(at(2026, 8, 1), today) }), 10)
})

test('one unkept, unpaused day ends it', () => {
  const today = at(2026, 8, 10)
  // Aug 5 missing → walk stops there. Aug 6..10 = 5 days.
  const kept = range(at(2026, 8, 1), today).filter(k => k !== '2026-08-05')
  assert.equal(walk({ today, kept }), 5)
})

test('THE REGRESSION: a week away leaves the number exactly where it was', () => {
  // 100 kept days ending Aug 1, then Aug 2–8 away with nothing done, and
  // today (Aug 9) nothing done yet either.
  const lastKept = at(2026, 8, 1)
  const kept = range(lastKept - 99 * DAY, lastKept)
  const paused = range(at(2026, 8, 2), at(2026, 8, 8))
  assert.equal(kept.length, 100)
  assert.equal(walk({ today: at(2026, 8, 9), kept, paused }), 100)
})

test('the same week away WITHOUT the pause marks kills it — this is the bug', () => {
  const lastKept = at(2026, 8, 1)
  const kept = range(lastKept - 99 * DAY, lastKept)
  assert.equal(walk({ today: at(2026, 8, 9), kept }), 0)
})

test('a day both away AND worked still counts — being abroad does not erase work', () => {
  const lastKept = at(2026, 8, 1)
  const kept = [...range(lastKept - 99 * DAY, lastKept), '2026-08-05']
  const paused = range(at(2026, 8, 2), at(2026, 8, 8))
  assert.equal(walk({ today: at(2026, 8, 9), kept, paused }), 101)
})

test('coming home and ticking something resumes from where it paused', () => {
  const lastKept = at(2026, 8, 1)
  const today = at(2026, 8, 9)
  const kept = [...range(lastKept - 99 * DAY, lastKept), dayKey(new Date(today))]
  const paused = range(at(2026, 8, 2), at(2026, 8, 8))
  assert.equal(walk({ today, kept, paused }), 101)
})

test('the trip ending on the doorstep does not kill it', () => {
  // The specific trap the leading step-over exists for: today is the last away
  // day, nothing done. Without stepping over it, the grace-day peek lands on
  // another away day and reports 0.
  const lastKept = at(2026, 8, 1)
  const kept = range(lastKept - 9 * DAY, lastKept)
  const paused = range(at(2026, 8, 2), at(2026, 8, 8))
  assert.equal(walk({ today: at(2026, 8, 8), kept, paused }), 10)
})

test('an away stretch with nothing before it is still zero, not a free streak', () => {
  // Paused days must not manufacture a streak out of nothing.
  const paused = range(at(2026, 8, 2), at(2026, 8, 8))
  assert.equal(walk({ today: at(2026, 8, 9), kept: [], paused }), 0)
})

test('nothing today is grace, not a break', () => {
  const today = at(2026, 8, 10)
  assert.equal(walk({ today, kept: range(at(2026, 8, 1), at(2026, 8, 9)) }), 9)
})

test('nothing today AND nothing yesterday is a break', () => {
  const today = at(2026, 8, 10)
  assert.equal(walk({ today, kept: range(at(2026, 8, 1), at(2026, 8, 8)) }), 0)
})

test('two separate trips both pause', () => {
  const kept = [...range(at(2026, 7, 1), at(2026, 7, 10)), ...range(at(2026, 7, 16), at(2026, 7, 20))]
  const paused = [...range(at(2026, 7, 11), at(2026, 7, 15)), ...range(at(2026, 7, 21), at(2026, 7, 25))]
  // 5 (Jul 16–20) + 10 (Jul 1–10) = 15, both gaps stepped over.
  assert.equal(walk({ today: at(2026, 7, 26), kept, paused }), 15)
})

test('the floor stops the walk', () => {
  const today = at(2026, 8, 10)
  assert.equal(walk({ today, kept: range(at(2026, 8, 1), today), floor: at(2026, 8, 6, 0) }), 5)
})

test('an unbounded paused stretch terminates rather than spinning', () => {
  // isPaused always true would walk forever without the guard.
  const n = walkStreak({ todayMs: at(2026, 8, 10), isKept: () => false, isPaused: () => true })
  assert.equal(n, 0)
})

test('dayKey is local, not UTC', () => {
  // A late-evening timestamp must not roll to the next day the way an ISO
  // slice would — the window is a statement about local days.
  assert.equal(dayKey(new Date(2026, 7, 4, 23, 30)), '2026-08-04')
  assert.equal(dayKey(new Date(2026, 7, 4, 0, 15)), '2026-08-04')
})
