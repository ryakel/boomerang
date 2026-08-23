import test from 'node:test'
import assert from 'node:assert/strict'
import { applyResumeFloor, parseYMD } from '../src/resumeFloor.js'

// `resume_at` is the third loop lever (migration 054). Before it there were
// only two: a completed_history stamp ("I did it" — credits AND moves the
// schedule) and skipped_days ("stop asking about that day" — no credit, no
// schedule change). Nothing said "the schedule moved", so "Skip cycle"
// expressed it by appending a completion stamp — crediting the cycle,
// extending the rally, growing the "Nx completed" total and filling in the
// trail, every time it was used.

const at = (y, m, d) => new Date(y, m - 1, d)

test('no floor leaves the due date exactly as computed', () => {
  const due = at(2026, 8, 20)
  assert.equal(applyResumeFloor(due, null), due)
  assert.equal(applyResumeFloor(due, undefined), due)
  assert.equal(applyResumeFloor(due, ''), due)
})

test('a later floor pushes the due date out to it', () => {
  const pushed = applyResumeFloor(at(2026, 8, 20), '2026-08-27')
  assert.equal(pushed.getTime(), at(2026, 8, 27).getTime())
})

test('THE POINT: a floor in the past is ignored, never dragging a loop backwards', () => {
  // Every loop still carrying last month's push would otherwise be yanked back
  // to a stale date the moment it came up again.
  const due = at(2026, 8, 20)
  assert.equal(applyResumeFloor(due, '2026-07-01'), due)
})

test('a floor equal to the due date changes nothing', () => {
  const due = at(2026, 8, 20)
  assert.equal(applyResumeFloor(due, '2026-08-20'), due)
})

test('the floor is a local day, not a UTC instant', () => {
  // A UTC-parsed floor lands on the wrong calendar day for anyone west of
  // Greenwich — the same bug the streak's dayKey exists to avoid.
  const f = applyResumeFloor(at(2026, 8, 1), '2026-08-15')
  assert.equal(f.getFullYear(), 2026)
  assert.equal(f.getMonth(), 7)
  assert.equal(f.getDate(), 15)
  assert.equal(f.getHours(), 0)
})

test('malformed floors are ignored rather than throwing', () => {
  const due = at(2026, 8, 20)
  for (const bad of ['nonsense', '2026-13-01', '2026-02-31', '20260815', 42, {}, [], NaN]) {
    assert.equal(applyResumeFloor(due, bad), due, `rejected: ${String(bad)}`)
  }
})

test('a missing due date passes straight through', () => {
  assert.equal(applyResumeFloor(null, '2026-08-27'), null)
  assert.equal(applyResumeFloor(undefined, '2026-08-27'), undefined)
})

test('parseYMD accepts real dates and rejects impossible ones', () => {
  assert.equal(parseYMD('2026-08-15').getDate(), 15)
  assert.equal(parseYMD('2028-02-29').getDate(), 29, 'leap day is real')
  assert.equal(parseYMD('2026-02-30'), null, 'rolled-over dates are not accepted')
  assert.equal(parseYMD('2026-13-01'), null)
  assert.equal(parseYMD(null), null)
})
