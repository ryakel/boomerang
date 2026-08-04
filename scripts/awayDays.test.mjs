import test from 'node:test'
import assert from 'node:assert/strict'
import { awayDaysElapsed, mergeAwayDays, MAX_AWAY_DAYS } from '../server/awayDays.js'

// These pin the rule that a trip must not end a streak. The 2026-08-03 incident
// was a 100-day streak lost to a week away, because the away window protected
// notifications and nothing else.

test('an active window covers every day from its start through today', () => {
  const days = awayDaysElapsed({ active: true, started_at: '2026-07-28', ends_at: null }, '2026-08-03')
  assert.deepEqual(days, [
    '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
    '2026-08-01', '2026-08-02', '2026-08-03',
  ])
})

test('today is included the moment it starts, not the next morning', () => {
  // Stamping only completed days leaves a hole on every day the app is opened
  // before midnight — which is every day.
  const days = awayDaysElapsed({ active: true, started_at: '2026-08-03', ends_at: null }, '2026-08-03')
  assert.deepEqual(days, ['2026-08-03'])
})

test('an inactive window covers nothing', () => {
  assert.deepEqual(awayDaysElapsed({ active: false, started_at: '2026-07-28' }, '2026-08-03'), [])
})

test('a window that has ended still covers the days it did cover', () => {
  // Coming home does not un-happen the trip. This is the case that makes
  // stamping necessary rather than deriving on the fly.
  const days = awayDaysElapsed({ active: true, started_at: '2026-07-28', ends_at: '2026-07-30' }, '2026-08-03')
  assert.deepEqual(days, ['2026-07-28', '2026-07-29', '2026-07-30'])
})

test('a window starting in the future covers nothing yet', () => {
  assert.deepEqual(awayDaysElapsed({ active: true, started_at: '2026-08-10' }, '2026-08-03'), [])
})

test('a window with no start speaks only for today', () => {
  // Nothing recorded when it was switched on, so claiming history would
  // silently inflate the streak.
  assert.deepEqual(awayDaysElapsed({ active: true, started_at: null }, '2026-08-03'), ['2026-08-03'])
})

test('a garbage or ancient start is capped rather than stamping forever', () => {
  const days = awayDaysElapsed({ active: true, started_at: '2000-01-01' }, '2026-08-03')
  assert.equal(days.length, MAX_AWAY_DAYS)
})

test('malformed input yields nothing rather than throwing', () => {
  assert.deepEqual(awayDaysElapsed(null, '2026-08-03'), [])
  assert.deepEqual(awayDaysElapsed({ active: true, started_at: 'nonsense' }, 'nope'), [])
})

test('the span crosses month and year boundaries correctly', () => {
  const days = awayDaysElapsed({ active: true, started_at: '2025-12-30' }, '2026-01-02')
  assert.deepEqual(days, ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'])
})

test('leap day is a real day', () => {
  const days = awayDaysElapsed({ active: true, started_at: '2028-02-27' }, '2028-03-01')
  assert.deepEqual(days, ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01'])
})

test('mergeAwayDays unions, sorts, and reports nothing-new as null', () => {
  assert.deepEqual(mergeAwayDays(['2026-08-02'], ['2026-08-01', '2026-08-02']),
    ['2026-08-01', '2026-08-02'])
  // No change → null, so the caller skips the write instead of churning the
  // settings blob (and its whole-blob sync) once a minute for nothing.
  assert.equal(mergeAwayDays(['2026-08-01', '2026-08-02'], ['2026-08-02']), null)
  assert.equal(mergeAwayDays([], []), null)
  assert.deepEqual(mergeAwayDays(null, ['2026-08-02']), ['2026-08-02'])
})
